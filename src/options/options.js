/**
 * Options page logic.
 * Reads stored config, populates inputs, saves on submit, resets to defaults.
 */

import CONFIG from '../config.js';

const DEFAULTS = {
  baselineTokens:         28_000,
  projectOverhead:        0,
  projectKnowledgeManual: 0,
  imageTokenEstimate:     1_600,
  placement:              'auto',
  autoReExpand:           true,
  handoff:                CONFIG.handoff,
  toolBaselines: {
    artifacts:           2_200,
    webSearch:          10_250,
    webSearchCitation:     450,
    codeExecution:       5_300,
    memory:              4_250,
    memorySearch:        3_000,
    profilePreferences:    850,
    mcpConnector:        1_000,
  },
  contextWindows: {
    'claude-opus-4-8':    500_000,
    'claude-opus-5':      1_000_000,
    'claude-sonnet-5':    1_000_000,
    'claude-opus-4-7':    500_000,
    'claude-opus-4-6':    500_000,
    'claude-sonnet-4-6':  500_000,
    'claude-haiku-4-5':   200_000,
    default:              200_000,
  },
  feedback: { enabled: true, endpoint: '' },
  fallbackCharsPerToken: {
    'claude-opus-5':    2.6,
    'claude-sonnet-5':  2.6,
    'claude-opus-4-8':  2.6,
    'claude-opus-4-7':  2.6,
    'claude-opus-4-6':  3.4,
    'claude-sonnet-4-6':3.4,
    'claude-haiku-4-5': 3.4,
    default:            2.6,
  },
  thresholds: { warn: 70, danger: 85 },
};

function populate(config) {
  set('baselineTokens',         config.baselineTokens         ?? DEFAULTS.baselineTokens);
  set('projectOverhead',        config.projectOverhead        ?? DEFAULTS.projectOverhead);
  set('projectKnowledgeManual', config.projectKnowledgeManual ?? DEFAULTS.projectKnowledgeManual);
  set('imageTokenEstimate',     config.imageTokenEstimate     ?? DEFAULTS.imageTokenEstimate);
  // Migrate the legacy 'nav' placement value to 'header'.
  const placement = config.placement === 'nav' ? 'header' : (config.placement ?? DEFAULTS.placement);
  setSelect('placement',  placement);
  setCheck('autoReExpand', config.autoReExpand ?? DEFAULTS.autoReExpand);

  const tb = config.toolBaselines ?? {};
  for (const [k, v] of Object.entries(DEFAULTS.toolBaselines)) {
    set(`tool-${k}`, tb[k] ?? v);
  }

  const cw = config.contextWindows ?? {};
  set('ctx-opus-4-8',   cw['claude-opus-4-8']   ?? 500_000);
  set('ctx-opus-5',     cw['claude-opus-5']     ?? 1_000_000);
  set('ctx-sonnet-5',   cw['claude-sonnet-5']   ?? 1_000_000);
  set('ctx-opus-4-7',   cw['claude-opus-4-7']   ?? 500_000);
  set('ctx-opus-4-6',   cw['claude-opus-4-6']   ?? 500_000);
  set('ctx-sonnet-4-6', cw['claude-sonnet-4-6'] ?? 500_000);
  set('ctx-haiku-4-5',  cw['claude-haiku-4-5']  ?? 200_000);
  set('ctx-default',    cw['default']            ?? 200_000);

  // Read the version from the manifest rather than hardcoding it here - the
  // hardcoded string had already drifted a full release behind.
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = 'v' + chrome.runtime.getManifest().version;

  const fb = config.feedback ?? {};
  set('feedback-endpoint', fb.endpoint ?? '');
  refreshFeedbackPermissionNote();

  const famEl = document.getElementById('tok-family');
  if (famEl) famEl.textContent = 'loaded on demand per model (v3 / v4.7 / v5)';

  const th = config.thresholds ?? {};
  set('thresh-warn',   Math.round((th.warn   ?? 0.70) * 100));
  set('thresh-danger', Math.round((th.danger ?? 0.85) * 100));

  const ho = config.handoff ?? {};
  setCheck('handoffEnabled',  ho.enabled  ?? DEFAULTS.handoff.enabled);
  set('handoffThreshold',     Math.round((ho.thresholdPct ?? DEFAULTS.handoff.thresholdPct) * 100));
  setCheck('handoffAutoSend', ho.autoSend ?? DEFAULTS.handoff.autoSend);
  set('handoffPrompt',        ho.prompt   ?? DEFAULTS.handoff.prompt);
  toggleAutoHint();
}

function collect() {
  return {
    baselineTokens:         num('baselineTokens'),
    projectOverhead:        num('projectOverhead'),
    projectKnowledgeManual: num('projectKnowledgeManual'),
    imageTokenEstimate:     num('imageTokenEstimate'),
    placement:              getSelect('placement'),
    autoReExpand:           getCheck('autoReExpand'),
    toolBaselines: {
      artifacts:          num('tool-artifacts'),
      webSearch:          num('tool-webSearch'),
      webSearchCitation:  num('tool-webSearchCitation'),
      codeExecution:      num('tool-codeExecution'),
      memory:             num('tool-memory'),
      memorySearch:       num('tool-memorySearch'),
      profilePreferences: num('tool-profilePreferences'),
      mcpConnector:       num('tool-mcpConnector'),
    },
    contextWindows: {
      'claude-opus-4-8':   num('ctx-opus-4-8'),
      'claude-opus-5':     num('ctx-opus-5'),
      'claude-sonnet-5':   num('ctx-sonnet-5'),
      'claude-opus-4-7':   num('ctx-opus-4-7'),
      'claude-opus-4-6':   num('ctx-opus-4-6'),
      'claude-sonnet-4-6': num('ctx-sonnet-4-6'),
      'claude-haiku-4-5':  num('ctx-haiku-4-5'),
      default:             num('ctx-default'),
    },

    feedback: {
      enabled:  true,
      endpoint: (document.getElementById('feedback-endpoint')?.value ?? '').trim(),
    },
    thresholds: {
      warn:   num('thresh-warn')   / 100,
      danger: num('thresh-danger') / 100,
    },
    handoff: {
      enabled:      getCheck('handoffEnabled'),
      thresholdPct: clamp(num('handoffThreshold'), 50, 95) / 100,
      autoSend:     getCheck('handoffAutoSend'),
      prompt:       (document.getElementById('handoffPrompt')?.value ?? DEFAULTS.handoff.prompt) || DEFAULTS.handoff.prompt,
    },
  };
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// ── DOM helpers ───────────────────────────────────────────────────────────────
function set(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}
function setSelect(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}
function getSelect(id) {
  return document.getElementById(id)?.value ?? 'auto';
}
function setCheck(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}
function getCheck(id) {
  return !!document.getElementById(id)?.checked;
}
function toggleAutoHint() {
  const hint = document.getElementById('handoffAutoHint');
  if (hint) hint.style.display = getCheck('handoffAutoSend') ? '' : 'none';
}
function num(id) {
  return parseInt(document.getElementById(id)?.value ?? '0', 10) || 0;
}
function flt(id) {
  return parseFloat(document.getElementById(id)?.value ?? '1') || 1;
}

// ── Status toast ──────────────────────────────────────────────────────────────
let statusTimer;
function showStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.className = ''; }, 2500);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get(['config'], (stored) => {
  populate(stored.config ?? {});
});

document.getElementById('handoffAutoSend')?.addEventListener('change', toggleAutoHint);

document.getElementById('save').addEventListener('click', async () => {
  const config = collect();
  // Ask for the feedback origin BEFORE saving: chrome.permissions.request must be
  // called from a user gesture, and this click is the only one available.
  const granted = await ensureFeedbackPermission();
  chrome.storage.local.set({ config }, () => {
    if (chrome.runtime.lastError) {
      showStatus('Error saving: ' + chrome.runtime.lastError.message, true);
      return;
    }
    refreshFeedbackPermissionNote();
    if (!granted) {
      // Saved, but feedback cannot actually send. Say so rather than a bare tick.
      showStatus('Saved — but permission for the feedback endpoint was declined, so the button will fail.', true);
    } else {
      showStatus('Saved ✓');
    }
  });
});

document.getElementById('reset').addEventListener('click', () => {
  populate({
    baselineTokens:         DEFAULTS.baselineTokens,
    projectOverhead:        DEFAULTS.projectOverhead,
    projectKnowledgeManual: DEFAULTS.projectKnowledgeManual,
    imageTokenEstimate:     DEFAULTS.imageTokenEstimate,
    placement:              DEFAULTS.placement,
    autoReExpand:           DEFAULTS.autoReExpand,
    toolBaselines:        DEFAULTS.toolBaselines,
    contextWindows:       DEFAULTS.contextWindows,
    fallbackCharsPerToken: DEFAULTS.fallbackCharsPerToken,
    thresholds:           { warn: 0.70, danger: 0.85 },
    handoff:              DEFAULTS.handoff,
  });
  showStatus('Reset to defaults (not yet saved)');
});


// ── Feedback endpoint permission ──────────────────────────────────────────────
// The relay origin is not known at build time, so the manifest asks for nothing
// beyond claude.ai. Permission for the operator's own endpoint is requested here,
// at the moment they save one — which is also the only moment it is justified.

function feedbackOriginPattern() {
  const raw = (document.getElementById('feedback-endpoint')?.value ?? '').trim();
  if (!raw) return null;
  try { return new URL(raw).origin + '/*'; } catch { return null; }
}

async function refreshFeedbackPermissionNote() {
  const note = document.getElementById('feedback-perm-note');
  if (!note) return;
  const pattern = feedbackOriginPattern();
  const raw = (document.getElementById('feedback-endpoint')?.value ?? '').trim();
  if (!raw) { note.textContent = 'Empty — the feedback button is hidden.'; return; }
  if (!pattern) { note.textContent = 'Not a valid URL.'; return; }
  if (!/^https:/i.test(raw)) { note.textContent = 'Must be https.'; return; }
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  note.textContent = granted
    ? `Permission granted for ${pattern}`
    : `Permission needed for ${pattern} — click Save to grant.`;
}

/** Ask for the endpoint's origin. Returns true when feedback can actually send. */
async function ensureFeedbackPermission() {
  const pattern = feedbackOriginPattern();
  if (!pattern) return true;                    // nothing configured: nothing to grant
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;                                // must be triggered by a user gesture
  }
}

document.getElementById('feedback-endpoint')
  ?.addEventListener('input', refreshFeedbackPermissionNote);
