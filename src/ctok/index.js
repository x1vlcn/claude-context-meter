/**
 * ctok — offline reconstruction of Claude's token counts.
 *
 * A JavaScript port of https://github.com/sanderland/ctok (MIT, Sander Land),
 * built for the browser: vocabularies load lazily as JSON so a session only pays
 * for the family its model actually uses.
 *
 * WHY this exists: the meter previously counted with gpt-tokenizer (OpenAI's
 * o200k_base) multiplied by a hand-tuned fudge factor. That bundles a 2.7 MB vocab
 * to produce a number measured to be 24%–144% off depending on model and content
 * type. ctok reproduces Anthropic's own count_tokens with zero under-counts across
 * 2.3M+ upstream test texts, from a 205 KB vocabulary for the current models.
 *
 * Accuracy caveat worth keeping in view: upstream validates SINGLE USER MESSAGES.
 * `messageOverhead` is the measured frame for one such message. A multi-turn
 * conversation's framing is NOT simply that constant per turn, which is why the
 * meter treats per-message content as the reliable part and calibrates the
 * remainder against the server's own input_tokens when a measurement is available.
 */

import { installTables, tablesInstalled } from './tables.js';
import { parseMarked, MARKER_GLYPHS } from './notation.js';
import { ReverseTrie, ByteFloor, buildVocab, tileCost } from './engine.js';
import { toCps } from './normalize.js';

/**
 * Tokenizer families. A family is a vocabulary plus the message-frame scalars.
 * v5 borrows v4.7's vocabulary and differs ONLY in framing — mirrors ctok's
 * FAMILIES table.
 */
const FAMILIES = {
  'v3':   { vocab: 'v3' },
  'v4.7': { vocab: 'v47' },
  'v5':   { vocab: 'v47',
            overrides: { messageOverhead: 6, frameBow: false, frameTail: 'free' } },
};

/**
 * claude.ai model id -> tokenizer family.
 *
 * Upstream routes by version number: [3.0, 4.7) -> v3, [4.7, 5.0) -> v4.7,
 * [5.0, inf) -> v5. Spelled out per model here so an unrecognised id fails loudly
 * (and falls back to an estimate) instead of being silently mis-tokenized.
 */
const MODEL_FAMILY = {
  'claude-opus-5':     'v5',
  'claude-sonnet-5':   'v5',
  // Fable 5 and Mythos 5 are 5-generation models and route to v5 by version. Their
  // FRAMING is not separately validated upstream (v5 was measured on Opus 5), so
  // treat their per-message overhead as provisional; content tokens are unaffected
  // because the vocabulary is shared with 4.7.
  'claude-fable-5':    'v5',
  'claude-mythos-5':   'v5',
  'claude-opus-4-8':   'v4.7',
  'claude-opus-4-7':   'v4.7',
  'claude-opus-4-6':   'v3',
  'claude-sonnet-4-6': 'v3',
  'claude-haiku-4-5':  'v3',
};

export function familyFor(modelId) {
  return MODEL_FAMILY[modelId] ?? null;
}

// ── data loading ──────────────────────────────────────────────────────────────

// Host-supplied JSON loader: name ('vocab-v47' | 'unicode-tables') -> Promise<object>.
// The extension wires this to chrome.runtime.getURL + fetch; the test harness to fs.
let loadJson = null;
export function configureLoader(fn) { loadJson = fn; }

const modelCache = new Map();     // family key -> Promise<Model>
let tablesPromise = null;

async function ensureTables() {
  if (tablesInstalled()) return;
  if (!tablesPromise) {
    tablesPromise = loadJson('unicode-tables').then((doc) => installTables(doc));
  }
  await tablesPromise;
}

const vocabCache = new Map();     // vocab name -> Promise<parsed vocab doc>
function loadVocab(name) {
  if (!vocabCache.has(name)) vocabCache.set(name, loadJson(`vocab-${name}`));
  return vocabCache.get(name);
}

/** The loaded vocabulary plus the family scalars the encoder and tiler read. */
function buildModel(doc, overrides) {
  const meta = { ...doc.meta, ...(overrides ?? {}) };

  const parsed = doc.pieces.map(parseMarked);
  const contractions = doc.contractions.map(parseMarked);

  // Single-codepoint pieces fold into the byte floor's membership set so an
  // uncovered character still prices at 1.
  const unitPieces = new Set();
  for (const p of parsed) {
    if (!MARKER_GLYPHS.has(p) && toCps(p).length === 1) unitPieces.add(p);
  }

  const model = {
    family:          meta.family,
    sourceModel:     meta.sourceModel,
    messageOverhead: meta.messageOverhead,
    foldQuotes:      meta.foldQuotes,
    allcapsMin:      meta.allcapsMin,
    frameBow:        meta.frameBow,
    frameTail:       meta.frameTail,
    // The characters the frame absorbs off the end of the content, per that rule.
    frameStrip:      meta.frameTail === 'ladder' ? '\n' : ' \t\n\r\f\v',
    unitPieces,
    bytes:           new ByteFloor(doc.bytesFallback, unitPieces),
    _charCostCache:  new Map(),
  };
  model.vocab = buildVocab(parsed, contractions);
  model.trie = new ReverseTrie(model.vocab);
  return model;
}

// Resolved models, for the synchronous fast path. A Promise cannot be read
// synchronously, so readiness is recorded separately as each load settles.
const ready = new Map();          // family key -> Model

/** Load (once) and return the tokenizer model for a family key. */
export function loadFamily(familyKey) {
  const spec = FAMILIES[familyKey];
  if (!spec) return Promise.reject(new Error(`unknown ctok family: ${familyKey}`));
  if (!modelCache.has(familyKey)) {
    modelCache.set(familyKey, (async () => {
      if (!loadJson) throw new Error('ctok: configureLoader() was never called');
      await ensureTables();
      const model = buildModel(await loadVocab(spec.vocab), spec.overrides);
      ready.set(familyKey, model);
      return model;
    })());
  }
  return modelCache.get(familyKey);
}

/**
 * Load the tokenizer for a claude.ai model id. Resolves to null for a model we
 * have no family mapping for — callers fall back to estimation rather than
 * counting with the wrong vocabulary.
 */
export function loadForModel(modelId) {
  const fam = familyFor(modelId);
  return fam ? loadFamily(fam) : Promise.resolve(null);
}

/**
 * The already-loaded model for `modelId`, or null. Lets the estimator stay
 * synchronous: content.js awaits loadForModel() when the model changes, and every
 * count after that is a plain function call.
 */
export function modelFor(modelId) {
  const fam = familyFor(modelId);
  return fam ? (ready.get(fam) ?? null) : null;
}

// ── counting ──────────────────────────────────────────────────────────────────

/**
 * Content tokens for `text` under `model` — the tiling cost WITHOUT the
 * single-message frame. This is the figure to sum across a conversation.
 */
export function countContent(text, model) {
  if (!text) return 0;
  return tileCost(text, model);
}

/**
 * Tokens for `text` as a single user message, frame included. Matches upstream
 * `ctok.token_count` exactly — this is the entry point the parity tests exercise.
 */
export function countMessage(text, model) {
  return model.messageOverhead + tileCost(text, model);
}
