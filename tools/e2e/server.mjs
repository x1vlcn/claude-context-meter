/**
 * Mock claude.ai for end-to-end testing of the BUILT extension.
 *
 * Serves a page shaped like a claude.ai conversation and the real dist/ bundles,
 * plus the two internal endpoints the extension reads:
 *
 *   GET /api/organizations/:org/chat_conversations/:id?tree=True   the message tree
 *   GET /api/organizations/:org/usage                              session/weekly quota
 *
 * This exercises the shipped artifacts and the real message-passing path between
 * injected.js and content.js — which unit tests cannot reach, because the bug
 * surface there is wiring (fetch hooking, postMessage, chrome.runtime.getURL,
 * badge mounting), not arithmetic.
 *
 * Usage: node tools/e2e/server.mjs [port]
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PORT = Number(process.argv[2] ?? 8742);
const ORG = '11111111-2222-3333-4444-555555555555';
const CONV = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ── the fake conversation ─────────────────────────────────────────────────────
// Shaped like claude.ai's tree=True payload: chat_messages[] with content blocks,
// per-message `model`, a `settings` object carrying the feature flags, and an
// artifact produced through tool_use.
const LOREM = 'We need to reconcile the ledger entries before the quarterly close. '
  + 'The reconciliation script walks every transaction, groups by account, and '
  + 'flags anything that does not net to zero across the paired journals. ';
const CODE = `function reconcile(entries) {\n`
  + `  const byAccount = new Map();\n`
  + `  for (const e of entries) {\n`
  + `    const bucket = byAccount.get(e.account) ?? [];\n`
  + `    bucket.push(e);\n`
  + `    byAccount.set(e.account, bucket);\n`
  + `  }\n`
  + `  return [...byAccount].filter(([, es]) => sum(es) !== 0);\n`
  + `}\n`;

function mkMessages(turns) {
  const out = [];
  for (let i = 0; i < turns; i++) {
    out.push({
      uuid: `h-${i}`, sender: 'human',
      content: [{ type: 'text', text: LOREM.repeat(6) + ` (turn ${i})` }],
    });
    out.push({
      uuid: `a-${i}`, sender: 'assistant', model: 'claude-opus-5',
      content: [
        { type: 'text', text: LOREM.repeat(10) },
        ...(i === 2 ? [{
          type: 'tool_use', name: 'artifacts',
          input: { command: 'create', id: 'recon', title: 'reconcile.js',
                   type: 'application/vnd.ant.code', content: CODE.repeat(12) },
        }] : []),
      ],
    });
  }
  return out;
}

const TREE = {
  uuid: CONV,
  name: 'Quarterly ledger reconciliation',
  model: 'claude-opus-5',
  settings: {
    enabled_artifacts_attachments: true,
    enabled_web_search: true,
    // Flipped by ?nocode=1 to exercise the hard-wall compaction prediction.
    enabled_monkeys_in_a_barrel: true,
    preview_feature_uses_artifacts: true,
  },
  chat_messages: mkMessages(12),
};

const USAGE = {
  five_hour:  { utilization: 0.4137, resets_at: '2026-08-23T21:00:00Z' },
  seven_day:  { utilization: 0.6612, resets_at: '2026-08-27T00:00:00Z' },
  seven_day_opus: { utilization: 0.8840, resets_at: '2026-08-27T00:00:00Z' },
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
};

async function serveFile(res, file) {
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

function json(res, obj) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// Test knobs. The extension builds the tree URL itself, so scenario switches
// cannot ride on that request - they are set here and picked up on reload.
const knobs = { codeExecution: true, turns: 12 };
let lastFeedback = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/__test/set') {
    for (const [k, v] of url.searchParams) {
      if (k === 'codeExecution') knobs.codeExecution = v !== '0';
      if (k === 'turns') knobs.turns = Math.max(1, Number(v) || 12);
    }
    return json(res, knobs);
  }

  // Internal API surface.
  if (p === `/api/organizations/${ORG}/chat_conversations/${CONV}`) {
    const tree = structuredClone(TREE);
    tree.settings.enabled_monkeys_in_a_barrel = knobs.codeExecution;
    tree.chat_messages = mkMessages(knobs.turns);
    return json(res, tree);
  }
  if (p === `/api/organizations/${ORG}/usage`) return json(res, USAGE);

  // Stands in for the operator's Discord relay.
  if (p === '/api/feedback' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    lastFeedback = body;
    console.log('[feedback received]', body);
    return json(res, { ok: true });
  }
  if (p === '/__test/last-feedback') return json(res, { body: lastFeedback });
  // Any other /api/organizations/<uuid>/ URL — its only job is to let injected.js
  // capture the org id the way it does on the real site.
  if (p.startsWith(`/api/organizations/${ORG}/`)) return json(res, { ok: true });

  // Extension artifacts, served from dist/ exactly as built.
  if (p.startsWith('/dist/')) return serveFile(res, path.join(ROOT, p.slice(1)));
  if (p.startsWith('/ctok/')) return serveFile(res, path.join(ROOT, 'dist', p.slice(1)));
  // content.js re-injects the main-world script through chrome.runtime.getURL,
  // which the shim maps to the site root. Serve it, or that injection lands on the
  // SPA shell and throws a SyntaxError that has nothing to do with the extension.
  if (p === '/injected.js') return serveFile(res, path.join(ROOT, 'dist', 'injected.js'));
  if (p === '/shim.js') return serveFile(res, path.join(import.meta.dirname, 'shim.js'));

  // Everything else is the SPA shell.
  return serveFile(res, path.join(import.meta.dirname, 'page.html'));
});

server.listen(PORT, () => {
  console.log(`mock claude.ai on http://localhost:${PORT}/chat/${CONV}`);
  console.log(`  org  ${ORG}`);
  console.log(`  conv ${CONV}  (${TREE.chat_messages.length} messages)`);
});
