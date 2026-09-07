/**
 * Derive the chars-per-token fallback constants used when the exact tokenizer is
 * unavailable (the brief window before a vocabulary finishes loading, or a model
 * with no ctok family).
 *
 * WHY measure rather than assume: the old fallback was a flat `charsPerToken: 4`
 * inherited from the usual "1 token ~ 4 characters" rule of thumb, which is an
 * OpenAI-tokenizer figure for English prose. Claude's tokenizer is denser, and how
 * much denser depends on both the family and the content type. Running ctok itself
 * over the upstream corpora gives the real ratio per family, split by content kind,
 * so the fallback is a measurement with a stated provenance rather than folklore.
 *
 * Usage: node tools/measure-fallback-ratio.mjs --ctok <path to cloned ctok repo>
 */

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import process from 'node:process';

import { configureLoader, loadFamily, countContent } from '../src/ctok/index.js';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'src', 'ctok', 'data');
configureLoader(async (name) =>
  JSON.parse(await readFile(path.join(DATA_DIR, `${name}.json`), 'utf8')));

const i = process.argv.indexOf('--ctok');
if (i === -1) { console.error('usage: --ctok <path>'); process.exit(2); }
const FIX = path.join(path.resolve(process.argv[i + 1]), 'tests', 'fixtures');

async function corpus(name) {
  const raw = gunzipSync(await readFile(path.join(FIX, `${name}.jsonl.gz`)));
  return raw.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// English-only slice of UDHR, since chat is overwhelmingly English for this user
// base and a 501-language mean would skew the constant toward dense scripts.
const ENGLISH_KEYS = new Set(['eng']);

async function main() {
  const udhr = await corpus('udhr');
  const rosetta = await corpus('rosetta');

  const sets = {
    'english prose': udhr.filter((r) => ENGLISH_KEYS.has(r.f)),
    'latin-script prose': udhr.filter((r) => r.script === 'Latn'),
    'all languages': udhr,
    'source code': rosetta,
  };

  const out = [];
  for (const family of ['v3', 'v4.7', 'v5']) {
    const model = await loadFamily(family);
    for (const [label, rows] of Object.entries(sets)) {
      let chars = 0, tokens = 0;
      for (const r of rows) { chars += [...r.text].length; tokens += countContent(r.text, model); }
      out.push({
        family, corpus: label, docs: rows.length,
        'chars/token': (chars / tokens).toFixed(3),
        'tokens/1k chars': Math.round((tokens / chars) * 1000),
      });
    }
  }
  console.table(out);
  console.log('\nUse chars/token for the "english prose" and "source code" rows as the');
  console.log('bracketing range; the shipped constant should sit between them.');
}

main().catch((e) => { console.error(e); process.exit(1); });
