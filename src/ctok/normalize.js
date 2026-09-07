/**
 * Text -> the marked stream: everything that happens before the tiling.
 *
 *   NFC + quote fold  ->  class split  ->  case marking  ->  boundary markers written in
 *
 * A direct port of ctok's normalize.py (MIT, Sander Land). Every rule is either a
 * designed rewrite of the text or a measured fact about Claude's tokenizer; the
 * reasoning behind each one lives upstream and is summarised in the comments below.
 * No costs live in this module.
 *
 * PORTING NOTE — codepoints, not UTF-16 units. Python indexes strings by codepoint;
 * JavaScript indexes by UTF-16 unit, so `s[0]` on an astral character yields half a
 * surrogate pair. Every run body here is therefore an ARRAY of single-codepoint
 * strings, and is only joined back into a string at the very end. Getting this
 * wrong silently corrupts counts for emoji, CJK extensions, and astral scripts.
 */

import {
  BOW_G, EOW_G, SHIFT_G, CAPS_G, LITERAL_MARKER_ESCAPES,
} from './notation.js';
import {
  WORDY, HARD, DIGIT, PUNCT, SPACE, STRAY,
  classifyCp, numKindCp, isSeparatorCp, isStrayMarkCp, marksLikePunctCp,
  isDigitBorderCp, isUpperCp, isLowerCp, isUnlowerableCp, lowerChar, lowerSpan,
} from './tables.js';

// ── normalization constants ───────────────────────────────────────────────────

// C0/C1 controls the API strips before tokenizing, i.e. every gc=Cc except TAB,
// LF and NUL.
const STRIP_CONTROL = /[\x01-\x08\x0B-\x1F\x7F\x80-\x9F]/g;
// BMP private use is stripped the same way.
const STRIP_PRIVATE = /[\uE000-\uF8FF]/g;
// Lone surrogates cannot be UTF-8 encoded and would crash the byte floor. Unlike
// Python, a JS string's surrogates are usually a well-formed PAIR — only fold the
// UNPAIRED ones, or every astral character would be destroyed.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// Space separators the tokenizer treats identically to U+0020: all Zs except
// U+3000 (ideographic space), plus Zl/Zp. U+3000, TAB and LF each have their own cost.
const FUNNY_SPACE = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F]/g;
// The four standard curly quotes fold to ASCII (v3 only). The low-9 mark U+201E is
// a different token and is deliberately not folded.
const QUOTE_FOLD = { '‘': "'", '’': "'", '“': '"', '”': '"' };
const QUOTE_FOLD_RE = /[\u2018\u2019\u201C\u201D]/g;

// The suffixes an apostrophe binds into the word ahead of it, deleting that word's
// <bow>. The standard English contraction set, lowercase and whole-word only.
const CONTRACTION_SUFFIXES = new Set(['s', 't', 'd', 'm', 'll', 're', 've']);

// <eow> ' ' [case markers] <bow>  ->  <eow> [case markers] <bow>: a single space
// between two marked spans is the seam and is not written as a character.
const SEAM_RE = new RegExp(`(.)${EOW_G} ([${SHIFT_G}${CAPS_G}]*)${BOW_G}`, 'gu');

const VS_LO = 0xFE00, VS_HI = 0xFE0F;   // variation selectors take no word model
const SHARP_S  = '\u1E9E';               // LATIN CAPITAL LETTER SHARP S
const DOTTED_I = '\u0130';              // LATIN CAPITAL LETTER I WITH DOT ABOVE

const ESCAPE_TABLE_RE = new RegExp(
  `[${Object.keys(LITERAL_MARKER_ESCAPES).join('')}]`, 'gu');

// ── helpers ───────────────────────────────────────────────────────────────────

const cp = (ch) => ch.codePointAt(0);
/** Split a string into single-codepoint strings (never half a surrogate pair). */
export const toCps = (s) => Array.from(s);

const isSelector = (ch) => { const o = cp(ch); return o >= VS_LO && o <= VS_HI; };

/** Python's `s.rstrip(chars)`. */
function rstripChars(s, chars) {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}

// ── nfc ───────────────────────────────────────────────────────────────────────

export function nfc(text, foldQuotes) {
  let t = text.replace(LONE_SURROGATE, '\uFFFD');
  t = t.normalize('NFC').replace(STRIP_CONTROL, '').replaceAll('\x00', ' ');
  // Claude composes decomposed Thai SARA AM, whose compatibility decomposition
  // NFC leaves alone. Lao SARA AM does not fold.
  t = t.replaceAll('\u0E4D\u0E32', '\u0E33');
  t = t.replace(STRIP_PRIVATE, '');
  if (foldQuotes) t = t.replace(QUOTE_FOLD_RE, (c) => QUOTE_FOLD[c]);
  return t.replace(FUNNY_SPACE, ' ');
}

/**
 * Whether raw text supplies the leading space the frame absorbs. A space that
 * normalization produced or exposed was not what the oracle read first, so it is
 * not absorbed.
 */
export const rawHeadSpace = (text) => text.startsWith(' ');

// ── case marking ──────────────────────────────────────────────────────────────

function spanIsUpper(cps) {
  let sawCased = false;
  for (const ch of cps) {
    const o = cp(ch);
    const up = isUpperCp(o), lo = isLowerCp(o);
    if (!up && !lo) continue;
    sawCased = true;
    if (!up) return false;
  }
  return sawCased;
}

/**
 * Cased span -> the marked form the tiler consumes.
 *
 * A case marker fires only on a WHOLE span: a pure all-caps span of length >=
 * allcapsMin becomes <caps> + lowercase, a pure title-case span becomes <shift> +
 * lowercase. Everything else stays literal, so `GaN`/`WiFi`/`QQ` keep their bytes.
 * allcapsMin === null disables <caps> entirely (v4.7+).
 */
export function markCase(cps, allcapsMin, headMark) {
  // An unattached mark opened the word, so its head is that mark and neither
  // marker can assert a lowered first letter.
  if (headMark) return cps.join('');
  const span = cps.join('');
  if (span.includes(SHARP_S)) return span;

  if (span.includes(DOTTED_I)) {
    const head = cps[0], tail = cps.slice(1);
    if (isUpperCp(cp(head)) && head !== DOTTED_I &&
        !tail.some((c) => c !== DOTTED_I && isUpperCp(cp(c)))) {
      return SHIFT_G + lowerChar(head) +
             tail.map((c) => (c === DOTTED_I ? c : lowerChar(c))).join('');
    }
    return span;
  }

  // A character with no lowered form blocks either marker: a marker in front of an
  // unchanged body would over-count.
  const unlowerable = cps.some((c) => isUnlowerableCp(cp(c)));

  if (allcapsMin !== null && spanIsUpper(cps) && cps.length >= allcapsMin && !unlowerable) {
    // The <caps> body lowers Σ to σ everywhere; an all-upper span contains no ς of
    // its own, so this only touches what lowering just produced.
    return CAPS_G + lowerSpan(cps).replaceAll('\u03C2', '\u03C3');
  }
  const head = cps[0];
  if (lowerChar(head) === head) return span;
  if (isUpperCp(cp(head)) && !cps.slice(1).some((c) => isUpperCp(cp(c)))) {
    return SHIFT_G + lowerSpan(cps);
  }
  return span;
}

// ── run splitting ─────────────────────────────────────────────────────────────

/** Which pretoken alternative a character of a HARD run belongs to. */
function hardKind(ch) {
  const o = cp(ch);
  if (marksLikePunctCp(o)) return 'punct';
  if (isDigitBorderCp(o)) return 'number';
  return 'letter';
}

const hardBow = (body) => body.length > 0 &&
  (isSelector(body[0]) || marksLikePunctCp(cp(body[0])));
const hardEow = (body) => body.length > 0 &&
  (isSelector(body[body.length - 1]) || marksLikePunctCp(cp(body[body.length - 1])));

/** A uniform run of decimal digits (Nd) or other numbers (No). */
function digitRun(body) {
  if (!body.length) return false;
  const k = numKindCp(cp(body[0]));
  if (!k) return false;
  for (let i = 1; i < body.length; i++) if (numKindCp(cp(body[i])) !== k) return false;
  return true;
}
const digitBow = (body) => digitRun(body) && isDigitBorderCp(cp(body[0]));
const digitEow = (body) => digitRun(body) && isDigitBorderCp(cp(body[body.length - 1]));

/**
 * The text split into maximal same-class runs, with terminal marks as unmarked
 * separators. A separator stands OUTSIDE the word: `C sep X` is written
 * `<bow>C<eow> sep <bow>X<eow>`.
 */
function splitRuns(cps) {
  if (!cps.length) return [];
  const out = [];
  let cur = [cps[0]];
  let curCls = classifyCp(cp(cps[0]));
  if (curCls === WORDY && isStrayMarkCp(cp(cps[0]))) curCls = STRAY;

  for (let i = 1; i < cps.length; i++) {
    const ch = cps[i];
    const c = classifyCp(cp(ch));
    const stray = isStrayMarkCp(cp(ch));
    if (curCls === STRAY && c === WORDY && stray) {
      cur.push(ch);                       // consecutive unattached marks are one run
    } else if (c === curCls) {
      cur.push(ch);
    } else if (c === WORDY && stray && curCls !== WORDY) {
      out.push({ cls: curCls, body: cur });
      cur = [ch]; curCls = STRAY;
    } else {
      out.push({ cls: curCls, body: cur });
      cur = [ch]; curCls = c;
    }
  }
  out.push({ cls: curCls, body: cur });

  // A HARD run is not homogeneous, so split it where the character kind changes;
  // the border predicates then apply per sub-run. A variation selector never opens
  // a sub-run — it rides its base, or `⚖️` would sever at the selector.
  const split = [];
  for (const run of out) {
    if (run.cls !== HARD || run.body.length === 1) { split.push(run); continue; }
    let sub = [run.body[0]];
    let kind = hardKind(run.body[0]);
    for (let i = 1; i < run.body.length; i++) {
      const ch = run.body[i];
      if (isSelector(ch) || hardKind(ch) === kind) { sub.push(ch); continue; }
      split.push({ cls: HARD, body: sub });
      sub = [ch]; kind = hardKind(ch);
    }
    split.push({ cls: HARD, body: sub });
  }
  return split;
}

// ── boundary predicates ───────────────────────────────────────────────────────

/** Whether run `i` is a lone `'` that opens the word after it (`a 'b`, `'First`). */
function opensWord(runs, i) {
  const r = runs[i];
  return r.body.length === 1 && r.body[0] === "'" &&
         i + 1 < runs.length &&
         (runs[i + 1].cls === WORDY || runs[i + 1].cls === STRAY);
}

/** Does this run write a boundary marker of its own on its right edge? */
function takesRightBorder(run) {
  return run.cls === PUNCT
      || hardEow(run.body)
      || ((run.cls === DIGIT || run.cls === HARD) && digitRun(run.body) && digitEow(run.body));
}

/**
 * Does a lone apostrophe immediately left of wordy run `i` supply that word's <bow>?
 * `it's` is one word boundary, not two — the apostrophe IS the boundary.
 */
function contractionSeam(runs, i) {
  if (i === 0) return false;
  if (!CONTRACTION_SUFFIXES.has(runs[i].body.join(''))) return false;
  const prev = runs[i - 1];
  if (prev.cls !== PUNCT || prev.body.length !== 1 || prev.body[0] !== "'") return false;
  return i < 2 || !takesRightBorder(runs[i - 2]);
}

// ── the marked stream ─────────────────────────────────────────────────────────

export function stream(text, model) {
  return streamNorm(nfc(text, model.foldQuotes), model, rawHeadSpace(text));
}

/**
 * The marked stream over already-normalized text. Split out from `stream` so a
 * document is NFC-folded once and the caller can read the content-final newline
 * run before rstrip drops it (see engine.frameTail).
 */
export function streamNorm(normText, model, headSpace = true) {
  // Protect literal occurrences of the codepoints used as internal markers. NFC
  // removed PUA input, so the escape values cannot collide with real text.
  let norm = normText.replace(ESCAPE_TABLE_RE, (c) => LITERAL_MARKER_ESCAPES[c]);

  // A "free" family strips on the raw text instead (see engine.tile); stripping
  // again here would eat a folded NBSP.
  if (model.frameTail === 'ladder') norm = rstripChars(norm, model.frameStrip);

  // A single leading space is dropped: the frame ends in <bow> and that <bow> IS
  // the space (' a' costs the same as 'a'). Two or more are a whitespace-run token
  // and stay. Where the frame has no <bow> (v5) there is nothing to stand in for.
  if (model.frameBow && headSpace && norm[0] === ' ' && norm[1] !== ' ') norm = norm.slice(1);

  const runs = splitRuns(toCps(norm));
  if (!runs.length) {
    // Content that normalizes away entirely still pays for the frame's <bow>.
    return model.frameBow ? BOW_G : '';
  }

  const caps = model.allcapsMin;
  const nRuns = runs.length;

  /**
   * Does this side of run `i` touch a space? Only a space counts — the marker
   * represents an absorbed space, so nothing else can stand in for one. Message
   * start counts (the frame ends in <bow>, which is a space); message end does not.
   */
  function bordersSpace(i, side) {
    const j = i + side;
    if (j < 0) return model.frameBow;
    if (j >= nRuns) return false;
    const nb = runs[j];
    if (nb.cls !== SPACE) return false;
    if (side < 0) return nb.body[nb.body.length - 1] === ' ';
    // Run-kills-marker: a right-hand marker is written for the seam space only,
    // never before a run of two or more spaces.
    return nb.body[0] === ' ' && !(nb.body.length >= 2 && nb.body[1] === ' ');
  }

  const first = runs[0];
  const headQuote = opensWord(runs, 0);
  const hasOwnBow = !headQuote && (
    first.cls === WORDY || first.cls === PUNCT || first.cls === STRAY
    || hardBow(first.body)
    || ((first.cls === DIGIT || first.cls === HARD) && digitBow(first.body))
    || (first.cls === SPACE && first.body[0] === ' ')
  );
  // Nothing to hand out where the frame ends in no <bow> (v5).
  const out = [];
  if (!hasOwnBow && model.frameBow) out.push(headQuote ? ' ' : BOW_G);

  for (let i = 0; i < nRuns; i++) {
    const { cls, body } = runs[i];

    if (cls === WORDY) {
      // A wordy span is flanked on both sides, except where a contraction
      // apostrophe is already its opening boundary, or an unattached mark run
      // already opened this word (then the span's head is the mark).
      const fused = i > 0 && runs[i - 1].cls === STRAY;
      let n = markCase(body, caps, fused);
      let pre = '';
      while (n[0] === SHIFT_G || n[0] === CAPS_G) {   // case markers precede <bow>
        pre += n[0]; n = n.slice(1);
      }
      const bow = (fused || contractionSeam(runs, i)) ? '' : BOW_G;
      out.push(pre + bow + n + EOW_G);

    } else if (cls === STRAY) {
      // A stray-mark pretoken is a word: <bow> on the left even beside a symbol or
      // digit, and <eow> on the right against everything except a letter, which is
      // the rest of the same word (`<bow>M abc<eow>` is ONE word).
      const letterFollows = i + 1 < nRuns && runs[i + 1].cls === WORDY;
      out.push(BOW_G + body.join('') + (letterFollows ? '' : EOW_G));

    } else if (cls === PUNCT || hardBow(body) || hardEow(body)) {
      // A punct span is marked only on the side bordering whitespace: `a! b` gets
      // `!<eow>`, `a!b` gets a bare `!`. The vocabulary decides whether a piece
      // swallows the marker.
      const takesBow = bordersSpace(i, -1) && !opensWord(runs, i)
                       && (cls === PUNCT || hardBow(body));
      const takesEow = bordersSpace(i, +1) && (cls === PUNCT || hardEow(body));
      out.push((takesBow ? BOW_G : '') + body.join('') + (takesEow ? EOW_G : ''));

    } else if ((cls === DIGIT || cls === HARD) && digitRun(body)) {
      // A digit run takes punctuation's border markers, decided by the border
      // character. Deliberately no lookback across the space.
      const takesBow = digitBow(body) && bordersSpace(i, -1);
      const takesEow = digitEow(body) && bordersSpace(i, +1);
      out.push((takesBow ? BOW_G : '') + body.join('') + (takesEow ? EOW_G : ''));

    } else {
      out.push(body.join(''));       // HARD letter scripts and whitespace: no markers
    }
  }

  return out.join('').replace(SEAM_RE, `$1${EOW_G}$2${BOW_G}`);
}
