/**
 * MV3 service worker — ephemeral by design.
 * Persists nothing in memory. All state lives in chrome.storage.local.
 */

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'install') return;

  chrome.storage.local.set({
    config: {
      baselineTokens:         28_000,
      projectOverhead:        0,
      projectKnowledgeManual: 0,
      imageTokenEstimate:     1_600,
      placement:              'auto',
      thresholds:             { warn: 0.70, danger: 0.85 },
      handoff:                { enabled: true, thresholdPct: 0.80, autoSend: false },
      toolBaselines:          {},
      contextWindows:         {},
      fallbackCharsPerToken:  {},
      feedback:               { enabled: true, endpoint: '' },
    },
    activeFeatures: {},
    badgePosition:  { right: 20, bottom: 80 },
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ping') {
    sendResponse({ type: 'pong' });
    return false;
  }

  // Feedback relay. The POST happens HERE, not in the content script: an MV3
  // content script's fetch is subject to the page's CORS rules, so a cross-origin
  // POST from claude.ai would be blocked. The service worker's fetch uses the
  // extension's own permissions instead.
  if (msg?.type === 'feedback') {
    sendFeedback(msg.payload).then(sendResponse);
    return true;                     // keep the message channel open for the async reply
  }

  return false;
});

async function sendFeedback(payload) {
  const { config } = await chrome.storage.local.get('config');
  const endpoint = config?.feedback?.endpoint?.trim();
  if (!endpoint) {
    return { ok: false, error: 'No feedback endpoint configured — set one in Options.' };
  }

  let origin;
  try { origin = new URL(endpoint).origin + '/*'; }
  catch { return { ok: false, error: 'Feedback endpoint is not a valid URL.' }; }

  // Permission is requested in Options when the endpoint is saved; if it was
  // revoked since, say so plainly rather than failing with an opaque network error.
  const allowed = await chrome.permissions.contains({ origins: [origin] });
  if (!allowed) {
    return { ok: false, error: 'Permission for that endpoint was not granted. Re-save it in Options.' };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `Relay returned HTTP ${res.status}.` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not reach the relay: ${String(e?.message ?? e)}` };
  }
}
