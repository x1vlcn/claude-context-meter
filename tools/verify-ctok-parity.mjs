/**
 * Parity gate for the JavaScript ctok port.
 *
 * Runs src/ctok against the upstream fixtures — real documents with RECORDED
 * `count_tokens` values from Anthropic's API — and requires an exact match on
 * every one. This is the only thing standing between "the port looks right" and
 * "the port is right": the tiling DP fails silently, producing a plausible number
 * rather than an error, so nothing short of document-for-document parity is
 * evidence.
 *
 * Corpora (from https://github.com/sanderland/ctok, MIT):
 *   udhr             501 natural languages — every script, case system and mark
 *   rosetta        1,741 real source files
 *   rosetta_holdout  250 files upstream's vocabulary mining never touched
 *   multipl_e         22 programming languages, same 25 problems each
 *
 * Usage: node tools/verify-ctok-parity.mjs --ctok <path to cloned ctok repo>
 */

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import process from 'node:process';

import { configureLoader, loadFamily, countMessage } from '../src/ctok/index.js';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'src', 'ctok', 'data');

configureLoader(async (name) =>
  JSON.parse(await readFile(path.join(DATA_DIR, `${name}.json`), 'utf8')));

// corpus -> { key: row field identifying a document, families: [family keys] }
const GATES = {
  udhr:            { key: 'f',    families: ['v3', 'v4.7'] },
  rosetta:         { key: 'id',   families: ['v3', 'v4.7'] },
  rosetta_holdout: { key: 'id',   families: ['v3', 'v4.7', 'v5'] },
  multipl_e:       { key: 'lang', families: ['v3', 'v4.7'] },
};

function parseArgs() {
  const i = process.argv.indexOf('--ctok');
  if (i === -1 || !process.argv[i + 1]) {
    console.error('usage: node tools/verify-ctok-parity.mjs --ctok <path to ctok repo>');
    process.exit(2);
  }
  return path.resolve(process.argv[i + 1]);
}

async function corpus(fixtures, name) {
  const raw = gunzipSync(await readFile(path.join(fixtures, `${name}.jsonl.gz`)));
  return raw.toString('utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

async function recorded(fixtures, name) {
  return JSON.parse(await readFile(path.join(fixtures, `${name}_counts.json`), 'utf8'));
}

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(2) : '0.00');

async function main() {
  const fixtures = path.join(parseArgs(), 'tests', 'fixtures');

  let totalDocs = 0, totalExact = 0, totalUnder = 0;
  const failures = [];
  const table = [];

  for (const [name, cfg] of Object.entries(GATES)) {
    const rows = await corpus(fixtures, name);
    const counts = await recorded(fixtures, name);

    for (const family of cfg.families) {
      if (!counts[family]) continue;          // fixture carries no baseline for it
      const expected = counts[family].counts;
      const model = await loadFamily(family);

      let exact = 0, under = 0, worst = 0, checked = 0;
      const t0 = performance.now();
      let chars = 0;

      for (const row of rows) {
        const want = expected[row[cfg.key]];
        if (want === undefined) continue;     // not baselined for this family
        checked++;
        chars += row.text.length;
        const got = countMessage(row.text, model);
        if (got === want) { exact++; continue; }
        if (got < want) under++;
        worst = Math.max(worst, Math.abs(got - want));
        if (failures.length < 12) {
          failures.push({ name, family, id: row[cfg.key], want, got,
                          chars: row.text.length });
        }
      }
      const ms = performance.now() - t0;
      totalDocs += checked; totalExact += exact; totalUnder += under;
      table.push({
        corpus: name, family, n: checked, exact,
        rate: `${pct(exact, checked)}%`, under, worst,
        'chars/s': `${Math.round(chars / (ms / 1000) / 1000)}k`,
      });
    }
  }

  console.table(table);

  if (failures.length) {
    console.log('\nFirst mismatches:');
    console.table(failures);
  }

  const ok = totalExact === totalDocs;
  console.log(
    `\n${ok ? 'PASS' : 'FAIL'} — ${totalExact.toLocaleString()}/${totalDocs.toLocaleString()} ` +
    `documents exact (${pct(totalExact, totalDocs)}%), ${totalUnder} under-counts.`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
