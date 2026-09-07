/**
 * Feedback relay — extension → Discord.
 *
 * Runs as a Vercel serverless function. The extension POSTs here; this forwards
 * to a Discord webhook held in the DISCORD_WEBHOOK_SECRET environment variable.
 *
 * That variable is read and NOTHING else is accepted as a fallback — in
 * particular not DISCORD_WEBHOOK_URL, which is the name the portal project uses
 * for its own shared webhook. Falling back to it would silently route meter
 * feedback into the portal's notification channel, which is the exact thing a
 * dedicated webhook exists to prevent.
 *
 * WHY a relay rather than posting to Discord from the extension: a webhook URL
 * shipped inside a browser extension is public. Anyone who installs it can read
 * it out of the bundle and post to the channel directly, and rotating it means
 * shipping a new release to every user. Here the URL lives in Vercel's env, is
 * rotatable in seconds, and every message passes through the validation below
 * before it reaches Discord.
 *
 * Setup:
 *   1. In Discord: Server Settings → Integrations → Webhooks → New Webhook,
 *      choose the channel, Copy Webhook URL.
 *   2. In Vercel: Project → Settings → Environment Variables →
 *      DISCORD_WEBHOOK_SECRET = <that URL>.  Do not commit it. Redeploy after
 *      saving; env vars are bound at deploy time.
 *   3. In the extension's Options: Relay endpoint URL =
 *      https://<your-deployment>/api/feedback
 */

// Discord hard-limits embed description to 4096 and each field value to 1024;
// we cap well under both so a long message cannot cause a silent 400.
const MAX_MESSAGE = 2000;
const MAX_DIAG_FIELDS = 20;
const VALID_KINDS = new Set(['bug', 'idea', 'other']);

// Ember, matching the meter's own accent.
const COLOR = 0xFF7A2D;

/**
 * Best-effort per-IP throttle. Serverless instances are recycled and requests
 * fan out across them, so this stops a naive flood from one client but is NOT a
 * real rate limiter. If the endpoint ever gets abused in earnest, move this to
 * Vercel KV or Upstash — the shape of the check stays the same.
 */
const RATE = { windowMs: 60_000, max: 5 };
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const seen = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
  seen.push(now);
  hits.set(ip, seen);
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE.windowMs)) hits.delete(k);
  }
  return seen.length > RATE.max;
}

function cors(res) {
  // The caller is an extension service worker, whose Origin is
  // chrome-extension://<id> and varies per install channel. This endpoint is a
  // write-only sink that returns nothing sensitive and takes no credentials, so
  // it is open rather than maintaining an allowlist of extension ids.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const webhook = process.env.DISCORD_WEBHOOK_SECRET;
  if (!webhook) {
    // Fail loudly in the log, vaguely to the caller — the client cannot fix this.
    // The log names the variable so a misconfigured deploy diagnoses itself.
    console.error('[feedback] DISCORD_WEBHOOK_SECRET is not set');
    return res.status(503).json({ error: 'Feedback is not configured yet.' });
  }

  const ip = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many messages. Try again shortly.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Body must be JSON.' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Body must be JSON.' });

  // Only accept what this extension sends. Anything else is someone poking at it.
  if (body.source !== 'claude-context-meter') {
    return res.status(400).json({ error: 'Unrecognised source.' });
  }
  const message = clean(body.message, MAX_MESSAGE);
  if (!message) return res.status(400).json({ error: 'Message is empty.' });

  const kind = VALID_KINDS.has(body.kind) ? body.kind : 'other';

  // Diagnostics are flattened to short scalar fields. Nested objects and long
  // values are dropped rather than stringified — the extension only ever sends
  // scalars, so anything else did not come from it.
  const diag = (body.diagnostics && typeof body.diagnostics === 'object') ? body.diagnostics : null;
  const fields = [];
  if (diag) {
    for (const [k, v] of Object.entries(diag)) {
      if (fields.length >= MAX_DIAG_FIELDS) break;
      if (v === null || typeof v === 'object') continue;
      fields.push({ name: clean(k, 40), value: '`' + clean(v, 60) + '`', inline: true });
    }
  }

  const titles = { bug: '🐞 Bug', idea: '💡 Idea', other: '💬 Feedback' };
  const embed = {
    title: titles[kind],
    description: message,
    color: COLOR,
    fields,
    footer: { text: diag?.version ? `Context Meter v${clean(diag.version, 16)}` : 'Context Meter' },
    timestamp: new Date().toISOString(),
  };

  try {
    const dr = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // allowed_mentions empty: a report is user-supplied text and must never be
      // able to ping @everyone or a role by writing it into the message.
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    });
    if (!dr.ok) {
      console.error('[feedback] discord returned', dr.status, await dr.text().catch(() => ''));
      return res.status(502).json({ error: 'Could not deliver to Discord.' });
    }
  } catch (e) {
    console.error('[feedback] discord request failed', e);
    return res.status(502).json({ error: 'Could not deliver to Discord.' });
  }

  return res.status(200).json({ ok: true });
}
