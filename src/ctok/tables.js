/**
 * Per-codepoint Unicode predicates, precomputed by tools/build-ctok-data.py.
 *
 * WHY a table instead of `\p{...}` regexes: ctok's classifier depends on the
 * canonical combining class (JavaScript exposes no API for it at all) and on
 * Python's exact isupper/islower semantics. Approximating those in JS would drift
 * silently whenever the browser's Unicode version differs from the one that built
 * the vocabulary, and a single misclassified codepoint changes a token count with
 * no visible error. The generator evaluates every predicate against the same
 * `unicodedata` ctok itself uses and ships the answers.
 *
 * Storage is [lo, hi] (inclusive) ranges, sorted and non-overlapping, so a lookup
 * is a binary search. `cls`/`numKind` carry a third element: the value.
 */

// Stream classes — must match tools/build-ctok-data.py.
export const WORDY = 0, HARD = 1, DIGIT = 2, PUNCT = 3, SPACE = 4;
// Synthetic class for an unattached combining mark (ctok's _STRAY_MARK).
export const STRAY = 5;

let T = null;

/** Install the parsed unicode-tables.json document. Called once by index.js. */
export function installTables(doc) { T = doc; }
export function tablesInstalled() { return T !== null; }

/** Binary search a [[lo, hi], ...] range array. */
function inRanges(ranges, cp) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (cp < r[0]) hi = mid - 1;
    else if (cp > r[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Binary search a [[lo, hi, value], ...] range array; `dflt` when unmatched. */
function valueInRanges(ranges, cp, dflt) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (cp < r[0]) hi = mid - 1;
    else if (cp > r[1]) lo = mid + 1;
    else return r[2];
  }
  return dflt;
}

// ctok's classify() defaults to HARD for anything the table does not name; the
// generator emits every assigned codepoint, so the default only catches gaps.
export const classifyCp    = (cp) => valueInRanges(T.cls, cp, HARD);
/** 0 = not a number, 1 = category Nd, 2 = category No. */
export const numKindCp     = (cp) => valueInRanges(T.numKind, cp, 0);
export const isSeparatorCp = (cp) => inRanges(T.separator, cp);
export const isStrayMarkCp = (cp) => inRanges(T.strayMark, cp);
export const marksLikePunctCp = (cp) => inRanges(T.punctLike, cp);
export const isDigitBorderCp  = (cp) => inRanges(T.digitBorder, cp);
export const isUpperCp     = (cp) => inRanges(T.isUpper, cp);
export const isLowerCp     = (cp) => inRanges(T.isLower, cp);
/** The per-character half of mark_case's `unlowerable` test. */
export const isUnlowerableCp = (cp) => inRanges(T.unlowerable, cp);

/**
 * ctok's char-wise `_lower`. JS toLowerCase() matches Python's per-character
 * lower() everywhere except the codepoints ctok deliberately treats as uncased
 * (U+03F4), which the generator captured into `lowerExceptions`.
 */
export function lowerChar(ch) {
  const ex = T.lowerExceptions[ch];
  return ex !== undefined ? ex : ch.toLowerCase();
}

/** ctok's `_lower(span)` — per character, never a whole-string lowering. */
export function lowerSpan(chars) {
  let out = '';
  for (const ch of chars) out += lowerChar(ch);
  return out;
}

export function unicodeVersion() { return T?.unicodeVersion ?? 'unknown'; }
