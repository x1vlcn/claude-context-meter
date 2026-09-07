/**
 * End-to-end checks for the pieces that have no browser in the loop: model
 * resolution, exact-vs-approximate counting, window sizing, and the compaction
 * prediction. Complements verify-ctok-parity.mjs, which proves the tokenizer is
 * right but says nothing about whether the estimator is wired to it.
 *
 * Usage: node tools/verify-integration.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import CONFIG from '../src/config.js';
import {
  assemble, tokenizeTree, countFor, tokenizerSource, approxTokens,
  resolveModelId, modelLabel, resolveEffort, effortLabel, predictCompaction,
} from '../src/estimator.js';
import { configureLoader, loadForModel, familyFor } from '../src/ctok/index.js';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'src', 'ctok', 'data');
configureLoader(async (name) =>
  JSON.parse(await readFile(path.join(DATA_DIR, `${name}.json`), 'utf8')));

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
}
function checkThat(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}${cond ? '' : `  ${detail}`}`);
}

// ── model resolution ──────────────────────────────────────────────────────────
console.log('\nModel resolution');
check('display name "Claude Opus 5"', resolveModelId('Claude Opus 5'), 'claude-opus-5');
check('display name "Sonnet 5"', resolveModelId('Sonnet 5'), 'claude-sonnet-5');
check('raw id passthrough', resolveModelId('claude-opus-4-8'), 'claude-opus-4-8');
check('label renders dots not spaces', modelLabel('claude-opus-4-8'), 'Opus 4.8');
check('label for Opus 5', modelLabel('claude-opus-5'), 'Opus 5');
check('unknown model resolves null', resolveModelId('Claude Nonesuch 9'), null);

// ── context windows (the P0 regression) ───────────────────────────────────────
console.log('\nContext windows');
check('Opus 5 = 1M', CONFIG.contextWindows['claude-opus-5'], 1_000_000);
check('Sonnet 5 = 1M', CONFIG.contextWindows['claude-sonnet-5'], 1_000_000);
check('Opus 4.8 = 500k', CONFIG.contextWindows['claude-opus-4-8'], 500_000);
check('Haiku 4.5 = 200k', CONFIG.contextWindows['claude-haiku-4-5'], 200_000);
checkThat('Fable 5 deliberately absent (chat availability unverified)',
  CONFIG.contextWindows['claude-fable-5'] === undefined);

// ── effort tiers ──────────────────────────────────────────────────────────────
console.log('\nEffort');
check('xhigh maps to itself', resolveEffort({ enumStr: 'xhigh' }), 'xhigh');
check('xhigh label', effortLabel('xhigh'), 'XHigh');
check('DOM "Extra High" maps to xhigh', resolveEffort({ domWord: 'extra high' }), 'xhigh');
check('legacy "extended" -> high', resolveEffort({ enumStr: 'extended' }), 'high');
check('unmappable value surfaces raw', resolveEffort({ enumStr: 'turbo' }), 'turbo');
check('nothing supplied -> null', resolveEffort({}), null);

// ── compaction prediction ─────────────────────────────────────────────────────
console.log('\nCompaction prediction');
check('code exec on -> will summarize',
  predictCompaction({ codeExecution: true }).state, 'will');
check('code exec off -> hard wall',
  predictCompaction({ codeExecution: false }).state, 'wall');
check('features unknown -> unknown',
  predictCompaction(null).state, 'unknown');

// ── counting: exact vs approximate ────────────────────────────────────────────
console.log('\nCounting');
const SAMPLE = 'The quick brown fox jumps over the lazy dog. '.repeat(40);

check('every confirmed model maps to a ctok family',
  CONFIG.confirmedWindowModels.filter((m) => !familyFor(m)), []);

const approxBefore = countFor(SAMPLE, 'claude-opus-5');
check('before load, countFor == approxTokens',
  approxBefore, approxTokens(SAMPLE, 'claude-opus-5'));
check('before load, source is approx', tokenizerSource('claude-opus-5'), 'approx');

await loadForModel('claude-opus-5');
const exact = countFor(SAMPLE, 'claude-opus-5');
check('after load, source is exact', tokenizerSource('claude-opus-5'), 'exact');
checkThat('exact count differs from the approximation',
  exact !== approxBefore, `both were ${exact}`);
checkThat(`approximation is within 25% of exact (approx ${approxBefore}, exact ${exact})`,
  Math.abs(approxBefore - exact) / exact < 0.25);

await loadForModel('claude-sonnet-4-6');
const v3Count = countFor(SAMPLE, 'claude-sonnet-4-6');
checkThat(`v3 family counts fewer tokens than v4.7 for the same text (${v3Count} < ${exact})`,
  v3Count < exact);

// ── assemble ──────────────────────────────────────────────────────────────────
console.log('\nAssemble');
const tree = {
  conversationId: 'test-conv',
  messages: [
    { role: 'human', text: SAMPLE },
    { role: 'assistant', text: SAMPLE + SAMPLE },
  ],
  attachments: [], artifacts: [], images: [],
  messageCount: 2,
};
const counts = tokenizeTree(tree, 'claude-opus-5');

const onWall = assemble({
  modelId: 'claude-opus-5',
  activeFeatures: { codeExecution: false, artifacts: true },
  featuresConfirmed: true,
  counts,
});
check('window applied', onWall.contextWindow, 1_000_000);
check('window confirmed', onWall.windowConfirmed, true);
check('tokenizer reported exact', onWall.tokenizer, 'exact');
check('hard wall predicted', onWall.compaction.state, 'wall');
checkThat('conversation tokens are the sum of the message rows',
  onWall.conversation === counts.messageItems.reduce((a, m) => a + m.tokens, 0));
checkThat('total exceeds baseline', onWall.total > CONFIG.baselineTokens);
checkThat(`pct is sane (${(onWall.pct * 100).toFixed(2)}%)`,
  onWall.pct > 0 && onWall.pct < 1);

const unconfirmed = assemble({
  modelId: 'claude-fable-5', activeFeatures: null, counts,
});
check('unknown model falls back to default window',
  unconfirmed.contextWindow, CONFIG.contextWindows.default);
check('and is flagged unconfirmed', unconfirmed.windowConfirmed, false);
check('and compaction is unknown', unconfirmed.compaction.state, 'unknown');

// The regression this whole exercise started from.
console.log('\nRegression: Opus 5 must not be metered against a 200k window');
const w = assemble({ modelId: 'claude-opus-5', activeFeatures: null, counts }).contextWindow;
checkThat(`Opus 5 window is 1M, not 200k (got ${w.toLocaleString()})`, w === 1_000_000);

console.log(`\n${failures ? `FAIL — ${failures} check(s) failed` : 'PASS — all checks passed'}`);
process.exit(failures ? 1 : 0);
