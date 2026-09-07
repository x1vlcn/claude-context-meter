/**
 * The min-cost tiling, with the marked-stream vocabulary indexed by a reverse trie.
 *
 * A port of ctok's engine.py (MIT, Sander Land). Claude's tokenizer is NOT
 * BPE-merge based — it behaves like minimum-piece tokenization (MinGram/PathPiece),
 * so the count is the cost of the cheapest tiling of the marked stream over the
 * vocabulary, with a UTF-8 byte floor for characters no piece covers. Every piece
 * costs exactly 1 token, so "min cost" is "fewest pieces".
 *
 * COUNT ONLY. Upstream also returns the chosen segmentation from `tokenize()`; we
 * deliberately do not port that. The meter needs the number, the DP already has it
 * in `best[n]`, and upstream is explicit that the boundaries are one valid tiling
 * rather than a claim about Anthropic's actual segmentation — so reconstructing
 * them would cost time and imply a precision that isn't there.
 */

import { MARKER_GLYPHS, ESCAPED_MARKER_LITERALS, EOW_G } from './notation.js';
import { nfc, streamNorm, rawHeadSpace, toCps } from './normalize.js';

// Trie terminal marker. A codepoint key is always a string, so `null` cannot collide.
const END = null;

const UTF8_ENCODER = new TextEncoder();

/**
 * Vocabulary index for the stream DP: pieces stored BACKWARDS, because the DP ends
 * a tile at each position and scans candidate starts right to left.
 */
export class ReverseTrie {
  constructor(pieces) {
    this.root = new Map();
    for (const piece of pieces) {
      const cps = toCps(piece);
      let node = this.root;
      for (let i = cps.length - 1; i >= 0; i--) {
        let next = node.get(cps[i]);
        if (next === undefined) { next = new Map(); node.set(cps[i], next); }
        node = next;
      }
      node.set(END, true);
    }
  }
}

/**
 * Min-cost tiling of `cps` over a cost-1 vocabulary plus a guaranteed
 * one-character floor. `unitCost(i)` prices the single codepoint at i when it is
 * not itself a piece. Returns the total cost.
 *
 * The trie visits only prefixes that can still become a piece, instead of probing
 * every substring up to the longest piece (128 codepoints on v3).
 */
export function minVocabTileCost(cps, trie, unitCost) {
  const n = cps.length;
  const best = new Int32Array(n + 1);
  const root = trie.root;

  for (let end = 1; end <= n; end++) {
    // The guaranteed one-character edge: the vocabulary spelling if it is a piece,
    // else the floor.
    let start = end - 1;
    let node = root.get(cps[start]);
    best[end] = best[start] + ((node !== undefined && node.has(END)) ? 1 : unitCost(start));
    if (node === undefined) continue;

    for (start = end - 2; start >= 0; start--) {
      node = node.get(cps[start]);
      if (node === undefined) break;
      if (node.has(END)) {
        const candidate = best[start] + 1;
        // `<=` mirrors upstream: starts decrease through the traversal, so
        // replacing on a tie keeps the longest-final-piece tie order.
        if (candidate <= best[end]) best[end] = candidate;
      }
    }
  }
  return best[n];
}

/**
 * What a codepoint costs when no piece covers it: a min-cost tiling of its UTF-8
 * bytes over the partial byte-prefix tokens, every single byte costing 1.
 */
export class ByteFloor {
  constructor(byteTokens, unitChars) {
    this.tokens = new Set(byteTokens);
    for (const c of unitChars) this.tokens.add(hexOf(c));
    let max = 1;
    for (const k of this.tokens) max = Math.max(max, k.length >> 1);
    this.maxLen = max;
    this._charCache = new Map();
  }

  /** Number of tokens the byte string tiles into. */
  costBytes(bytes) {
    const n = bytes.length;
    const best = new Int32Array(n + 1).fill(0x7fffffff);
    best[0] = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = Math.max(0, i - this.maxLen); j < i; j++) {
        if (best[j] === 0x7fffffff) continue;
        // A single byte is always allowed; longer segments must be known prefixes.
        const ok = (i - j === 1) || this.tokens.has(hexSlice(bytes, j, i));
        if (ok && best[j] + 1 < best[i]) best[i] = best[j] + 1;
      }
    }
    return best[n];
  }

  /** Isolated codepoint cost via the byte floor. */
  costChar(ch) {
    let hit = this._charCache.get(ch);
    if (hit === undefined) {
      const bytes = UTF8_ENCODER.encode(ch);
      hit = this.tokens.size ? this.costBytes(bytes) : bytes.length;
      this._charCache.set(ch, hit);
    }
    return hit;
  }
}

function hexOf(ch) {
  return hexSlice(UTF8_ENCODER.encode(ch), 0, undefined);
}
function hexSlice(bytes, from, to) {
  let s = '';
  const end = to === undefined ? bytes.length : to;
  for (let i = from; i < end; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * The tiling vocabulary: every parsed piece plus the glued contraction spelling.
 * The file stores `'t`; the encoder writes `'t<eow>`.
 *
 * Structural markers are NOT added here — they live in the vocabulary file's
 * `markers` group, the one place that decides a marker costs one token.
 */
export function buildVocab(parsedPieces, contractions) {
  const vocab = new Set(parsedPieces);
  for (const cn of contractions) vocab.add(cn + EOW_G);
  return vocab;
}

/** One codepoint standing alone: 1 if it is itself a token, else its byte-floor tiling. */
function charCost(model, ch) {
  const real = ESCAPED_MARKER_LITERALS[ch] ?? ch;
  let hit = model._charCostCache.get(real);
  if (hit === undefined) {
    hit = model.unitPieces.has(real) ? 1 : model.bytes.costChar(real);
    model._charCostCache.set(real, hit);
  }
  return hit;
}

/**
 * What a content-final run of `n` frame-absorbed newlines costs beyond the frame's
 * own trailing token. Ladder families only; on v5 trailing whitespace is free.
 *
 * The frame appends two newlines after the content and one token can span into
 * them, so the run the tokenizer sees is n + 2 newlines, of which the frame already
 * pays for one token. The cost is therefore NOT monotonic in n (28 trailing
 * newlines are free, 29 cost one).
 */
function frameTailCost(n, model) {
  if (n === 0 || model.frameTail !== 'ladder') return 0;
  const run = toCps('\n'.repeat(n + 2));
  const total = minVocabTileCost(run, model.trie, () => 1);
  return total - 1;                 // the last token is the frame's own newline pair
}

/** Count trailing characters of `s` that are in `chars`. */
function trailingRun(s, chars) {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && chars.includes(s[i]); i--) n++;
  return n;
}
function rstripChars(s, chars) {
  return s.slice(0, s.length - trailingRun(s, chars));
}

/**
 * Content token count for `text` — the tiling cost of its marked stream, EXCLUDING
 * the per-message frame. Add `model.messageOverhead` for a single-message request.
 */
export function tileCost(text, model) {
  let norm, nTail;
  if (model.frameTail === 'ladder') {
    norm = nfc(text, model.foldQuotes);
    nTail = trailingRun(norm, model.frameStrip);
  } else {
    // The frame absorbs raw ASCII whitespace, so strip BEFORE NFC: nfc folds NBSP
    // to U+0020 and those are not free at the end.
    norm = nfc(rstripChars(text, model.frameStrip), model.foldQuotes);
    nTail = 0;
  }

  const s = streamNorm(norm, model, rawHeadSpace(text));
  const tail = frameTailCost(nTail, model);
  if (!s) return tail;

  const cps = toCps(s);
  const unitFloor = (j) => {
    const ch = cps[j];
    // A marker no piece absorbed tiles as itself.
    if (MARKER_GLYPHS.has(ch)) return 1;
    return charCost(model, ch);
  };
  return minVocabTileCost(cps, model.trie, unitFloor) + tail;
}
