/**
 * Checks the Vercel feedback relay without deploying it or touching Discord.
 *
 * The handler is called directly with mock req/res objects and a stubbed fetch,
 * so every branch is exercised — including the ones that matter for a public
 * endpoint: rejecting junk, capping length, refusing to let user text mention
 * @everyone, and throttling a flood.
 *
 * Usage: node tools/verify-feedback-relay.mjs
 */

import process from 'node:process';

process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/api/webhooks/mock';

const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 204, text: async () => '' };
};

const { default: handler } = await import('../api/feedback.js');

function mockRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.end = () => res;
  return res;
}

const call = async (body, { method = 'POST', ip = '1.2.3.4' } = {}) => {
  const res = mockRes();
  await handler({ method, body, headers: { 'x-forwarded-for': ip } }, res);
  return res;
};

let fail = 0;
function check(label, cond, detail = '') {
  if (!cond) fail++;
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}${cond ? '' : `  ${detail}`}`);
}

const VALID = {
  source: 'claude-context-meter',
  kind: 'bug',
  message: 'The percentage sticks at 0% on a brand new chat.',
  diagnostics: { version: '0.8.1', model: 'claude-opus-5', window: 1000000, pct: 3.2,
                 tokenizer: 'exact', compaction: 'will' },
};

console.log('\nHappy path');
let r = await call(VALID);
check('returns 200', r.statusCode === 200, `got ${r.statusCode}`);
check('posted to the webhook', sent.length === 1);
const embed = sent[0]?.body?.embeds?.[0];
check('carries the message', embed?.description === VALID.message);
check('titled by kind', embed?.title?.includes('Bug'));
check('diagnostics became fields', embed?.fields?.length === 6, `got ${embed?.fields?.length}`);
check('footer names the version', embed?.footer?.text === 'Context Meter v0.8.1');
check('mentions are disabled', JSON.stringify(sent[0].body.allowed_mentions) === '{"parse":[]}');

console.log('\nCORS / method');
r = await call(null, { method: 'OPTIONS', ip: '9.9.9.1' });
check('preflight is 204', r.statusCode === 204);
check('allows cross-origin POST', r.headers['access-control-allow-methods']?.includes('POST'));
r = await call(null, { method: 'GET', ip: '9.9.9.2' });
check('GET is rejected', r.statusCode === 405);

console.log('\nRejects junk');
r = await call({ source: 'somebody-else', message: 'hi' }, { ip: '2.2.2.1' });
check('unknown source rejected', r.statusCode === 400, `got ${r.statusCode}`);
r = await call({ source: 'claude-context-meter', message: '   ' }, { ip: '2.2.2.2' });
check('empty message rejected', r.statusCode === 400);
r = await call('not json at all', { ip: '2.2.2.3' });
check('non-JSON body rejected', r.statusCode === 400);

console.log('\nCaps and sanitising');
sent.length = 0;
r = await call({
  source: 'claude-context-meter',
  kind: 'nonsense',
  message: 'x'.repeat(5000),
  diagnostics: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(200)])),
}, { ip: '3.3.3.1' });
const e2 = sent[0]?.body?.embeds?.[0];
check('accepted', r.statusCode === 200);
check('message capped at 2000', e2.description.length === 2000, `got ${e2.description.length}`);
check('unknown kind falls back to other', e2.title.includes('Feedback'));
check('field count capped at 20', e2.fields.length === 20, `got ${e2.fields.length}`);
check('field values capped', e2.fields.every((f) => f.value.length <= 62));

sent.length = 0;
await call({ source: 'claude-context-meter', message: 'ping @everyone and @here now' }, { ip: '3.3.3.2' });
check('user text cannot ping the server',
  JSON.stringify(sent[0].body.allowed_mentions) === '{"parse":[]}');

console.log('\nThrottle');
let last;
for (let i = 0; i < 8; i++) last = await call(VALID, { ip: '4.4.4.4' });
check('a flood from one IP is throttled', last.statusCode === 429, `got ${last.statusCode}`);
const other = await call(VALID, { ip: '5.5.5.5' });
check('a different IP is unaffected', other.statusCode === 200, `got ${other.statusCode}`);

console.log('\nUnconfigured');
delete process.env.DISCORD_WEBHOOK_URL;
r = await call(VALID, { ip: '6.6.6.6' });
check('missing webhook returns 503, not a crash', r.statusCode === 503);

console.log(`\n${fail ? `FAIL — ${fail} check(s) failed` : 'PASS — all checks passed'}`);
process.exit(fail ? 1 : 0);
