/**
 * Content script — runs in the isolated world on https://claude.ai/*
 *
 * v0.3 flow:
 *   1. Injects injected.js into the page's main world (fetch interception)
 *   2. Listens for postMessage data back from injected.js
 *   3. Token source priority:
 *        a. measured  — SSE usage.input_tokens (ground truth context size)
 *        b. tree      — tokenized from captured /chat_conversations?tree=true JSON
 *                       (counts ALL turns incl. virtualized/collapsed + closed artifacts)
 *        c. dom       — legacy rendered-DOM scan (brand-new chat / pre-fetch window)
 *      The live streaming output delta is layered on top of (a)/(b)/(c).
 *   4. Caches the last per-conversation tally in chrome.storage.local to bridge
 *      the brief window before the tree fetch resolves on (re)load.
 *   5. Badge placed top-center of the app header (near the title), floating fallback.
 *   6. MutationObserver: re-detect model/effort, re-inject badge on header re-render.
 */

import CONFIG from './config.js';
import { Badge } from './badge.js';
import {
  assemble, tokenizeTree, tokenizeDOM, mapSettings, resolveModelId,
  detectEffortFromDOM, resolveEffort, effortLabel,
  countFor, tokenizerSource, modelLabel, SEL,
} from './estimator.js';
import { configureLoader, loadForModel, familyFor } from './ctok/index.js';

// ── Tokenizer data loading ────────────────────────────────────────────────────
// The ctok vocabularies live as JSON in the extension bundle rather than inside
// content.js: together they are ~1.2 MB and a session needs exactly one of them,
// so they are fetched on demand instead of parsed on every page load.
configureLoader(async (name) => {
  const res = await fetch(chrome.runtime.getURL(`ctok/${name}.json`));
  if (!res.ok) throw new Error(`ctok/${name}.json: HTTP ${res.status}`);
  return res.json();
});

// Model ids we have already asked for, so a failed or in-flight load is not retried
// on every scan.
const tokenizerRequested = new Set();

/**
 * Ensure the exact tokenizer for the current model is loaded, then recount.
 *
 * Counting is synchronous everywhere else, so this is the one asynchronous seam:
 * until the vocabulary lands the meter counts with the o200k approximation and
 * labels itself `approx`; when it lands we discard the cached tree counts and
 * recount exactly. A model with no ctok family stays on the approximation for good.
 */
function ensureTokenizer() {
  const id = state.modelId;
  if (!id || tokenizerRequested.has(id)) return;
  tokenizerRequested.add(id);
  if (!familyFor(id)) return;              // no vocabulary for this model — stay approx
  loadForModel(id).then((model) => {
    if (!model) return;
    // Counts taken before the vocabulary arrived were approximations. Force the
    // cached tree to be re-tokenized exactly.
    state.treeModel = null;
    retokenizeTreeIfModelChanged();
    scheduleScan(50);
  }).catch((e) => {
    console.warn('[ccm] ctok load failed, continuing with approximate counts:', e);
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  modelId:         null,
  modelConfirmed:  false,
  // null until detected from the completion payload (preferred) or the visible
  // composer selector. NOT defaulted to a tier — defaulting was the v0.5 bug.
  effort:          null,
  // null = conversation settings have not arrived yet. Deliberately NOT {} — an
  // empty object is indistinguishable from "every feature off", and the compaction
  // prediction would then report a hard wall before it knows anything.
  activeFeatures:  null,
  // Conversation the cached activeFeatures were read from. The compaction
  // prediction is only made when this matches the conversation on screen.
  featuresConvId:  null,
  conversationId:  null,
  isStale:         false,
  prevEstimate:    0,
  projectOverhead: 0,
  projectKnowledgeManual: 0,
  placement:       'auto',

  // Tree-sourced counts for the current conversation (cached; re-run only on tree
  // fetch or model change). treeRaw is the full payload, kept in memory so we can
  // re-tokenize if the model (→ multiplier) is confirmed after the fetch.
  treeCounts:      null,
  treeRaw:         null,
  treeConvId:      null,
  treeModel:       null,   // modelId the cached counts were tokenized with

  // Source state for the badge indicator.
  // 'loading'  — active fetch in flight, no data yet (or first visit)
  // 'cached'   — showing per-conv localStorage tally while active fetch runs
  // 'tree'     — fresh authoritative tree fetch completed (high trust)
  // 'partial'  — tree unavailable, DOM-only estimate (show ~ marker)
  // 'measured' — not tracked here; signaled via breakdown.measured (SSE ground truth)
  treeSource:      'loading',
  isRefreshing:    false,

  // Ground-truth measured context from SSE.
  measuredInputTokens: null,
  liveOutputTokens:    0,

  // Project custom instructions / knowledge.
  projectInstructionTokens:   0,
  projectKnowledgeUnmeasured: false,

  // Session / weekly quota from the /usage endpoint, plus the live SSE
  // message_limit fraction. Distinct from context fill: this is allowance spent.
  quota:         null,   // { session, weekly, opus } | { unknownShape } | { error }
  messageLimit:  null,   // raw SSE message_limit payload (exact, unrounded)

  // Handoff (context chaining) — armed once per conversation at the threshold.
  handoff:       { status: 'idle', convId: null, note: '' }, // idle|armed|requested|done|dismissed
  lastBreakdown: null,
};

// DOM artifact cache (fallback mode only): key → { title, tokens }
const artifactCache = new Map();

let badge        = null;
let scanTimer    = null;
let observerInit = false;
let headerAnchor = null;   // element we injected into (header mode)
let headerMode   = false;  // true when badge lives in the header (vs floating)

// Auto-collapse state for 'auto' placement mode.
// true = we moved to header because a right-side panel opened / width narrowed.
let autoCollapsed       = false;
let layoutObserver      = null;   // ResizeObserver on the chat column
let effortObserver      = null;   // MutationObserver watching the effort selector element


// Right-side panel selectors (artifact viewer, code preview, etc.).
// When any of these are visible on the right half of the screen the badge collapses.
const RIGHT_PANEL_SEL = [
  '[data-testid="artifact-viewer"]',
  '[data-testid="artifacts-panel"]',
  '[data-testid="artifact-panel"]',
  '[data-testid="preview-panel"]',
  '[data-testid="code-runner"]',
  '[data-testid="artifact-content"]',
].join(', ');

// ── Boot ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get(
  ['config', 'badgePosition', 'activeFeatures'],
  (stored) => {
    if (stored.config) mergeStoredConfig(stored.config);
    if (stored.activeFeatures) state.activeFeatures = stored.activeFeatures;

    injectMainWorld();
    window.addEventListener('message', onMessage);

    state.conversationId = extractConvId();
    initBadge(stored.badgePosition);

    loadCachedTally();
    detectModelFromDOM();
    detectEffort();
    watchEffortElement();
    // Proactively fetch the tree — don't rely solely on intercepting claude.ai's one-time fetch.
    requestActiveFetch(state.conversationId);
    // Same reasoning for quota: injected.js fires its first usage fetch the moment
    // it scrapes the org id, which is long before this listener exists. Ask again
    // now that we are actually listening (injected.js replays its cached payload,
    // so this costs no extra request).
    requestUsageFetch(true);
    scheduleScan();
    startObserver();
  },
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.config)        mergeStoredConfig(changes.config.newValue);
  if (changes.activeFeatures) state.activeFeatures = changes.activeFeatures.newValue;
  scheduleScan();
});

// ── Responsive relayout ─────────────────────────────────────────────────────────
// When the viewport crosses the compact breakpoint (resize / orientation change),
// toggle the badge's compact layout and re-place it (narrow → floating bottom-sheet,
// wide → eligible for the header anchor again).
let lastNarrow = isNarrow();
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayout, 250);
});

function relayout() {
  const narrow = isNarrow();
  badge?.setCompact(narrow);
  if (narrow !== lastNarrow) {
    lastNarrow = narrow;
    if (narrow && headerMode) {
      // Header anchor no longer appropriate — drop to the floating bottom-sheet layout.
      badge?._host?.remove();
      layoutObserver?.disconnect();
      makeFloatingBadge();
      scheduleScan(80);
    } else if (!narrow && !headerMode && (state.placement === 'header' || state.placement === 'nav')) {
      // Explicitly-header placement: re-home into header when wide again.
      maybeUpgradeToHeader();
      scheduleScan(80);
    }
  }
  // Always re-check auto placement on resize (handles right-panel / gutter changes).
  checkAutoPlacement();
}

// ── Inject main-world script ──────────────────────────────────────────────────
function injectMainWorld() {
  if (document.getElementById('ccm-injected-script')) return;
  const s = document.createElement('script');
  s.id  = 'ccm-injected-script';
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head ?? document.documentElement).appendChild(s);
}

// ── Badge placement ───────────────────────────────────────────────────────────
// Anchor to the app header near the conversation title. Resilient selectors only.
const TITLE_CANDIDATES = [
  '[data-testid="conversation-title"]',
  '[data-testid="chat-title"]',
  'header [data-testid="chat-menu-trigger"]',
  '[data-testid="chat-menu-trigger"]',
  'header h1',
  '[role="banner"] h1',
];

const HEADER_CANDIDATES = [
  '[data-testid="chat-header"]',
  'header[role="banner"]',
  '[role="banner"]',
  'header',
];

function findTitleEl() {
  for (const sel of TITLE_CANDIDATES) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return el;
  }
  return null;
}

function findHeaderEl() {
  for (const sel of HEADER_CANDIDATES) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return el;
  }
  // Last resort: the model selector's header ancestor.
  const model = document.querySelector(SEL.modelButton);
  return model?.closest('header, nav, [role="banner"]') ?? null;
}

function isVisible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function badgeCallbacks(extra = {}) {
  return {
    onReset:           handleReset,
    onRefresh:         handleRefresh,
    onHandoffGenerate: () => doHandoffSend(),
    onHandoffCopy:     () => doHandoffCopy(),
    onHandoffDismiss:  () => { state.handoff.status = 'dismissed'; scan(); },
    // VulcanAX session-handoff doc (stats auto-filled; semantic slots left empty).
    onHandoffDoc:         () => copyHandoffDoc(),
    onHandoffDocDownload: () => downloadHandoffDoc(),
    onFeedback:           sendFeedback,
    feedbackDiagnostics:  feedbackDiagnostics,
    onHandoffDocAsk:      () => copyChatSideAsk(),
    ...extra,
  };
}

// Narrow viewport → compact pill + bottom-sheet panel, and force floating
// placement (claude.ai's mobile header is cramped / differently shaped, so the
// header anchor is unreliable there). Width-based; coarse-pointer hit targets are
// handled separately by CSS @media (pointer: coarse).
function isNarrow() {
  return window.innerWidth < (CONFIG.responsive?.compactBreakpoint ?? 640);
}

// ── Left-center placement helpers ─────────────────────────────────────────────

// Return an element in the chat area for the ResizeObserver to watch.
// Placement decisions use findChatContentLeft() — this is only for the observer.
function findChatColumn() {
  // Known stable column selector on current claude.ai (max-w-3xl mx-auto centering div).
  const col = document.querySelector('#main-content div.max-w-3xl.mx-auto')
           ?? document.querySelector('#main-content div.max-w-2xl.mx-auto');
  if (col) return col;
  // Fallback: nearest scrollable ancestor of a turn element.
  const msgEl = document.querySelector(`${SEL.humanTurn}, ${SEL.aiTurn}`);
  if (msgEl) {
    let el = msgEl.parentElement;
    while (el && el !== document.body) {
      const ov = getComputedStyle(el).overflowY;
      if (ov === 'auto' || ov === 'scroll') return el;
      el = el.parentElement;
    }
    return msgEl;
  }
  for (const sel of ['[role="main"]', 'main']) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// Ground-truth left-edge of the chat column.
// Priority order:
//   1. Known stable Tailwind column selector (#main-content .max-w-3xl.mx-auto) —
//      the centered content div on current claude.ai.
//   2. Range probe — measures first text character's left position, immune to nesting depth.
//   3. Turn element's own left edge (works when turn width == column width).
// Returns null when no content is found yet (blank page, still rendering).
function findChatContentLeft() {
  // P1: Known column element — cheapest and most accurate when present.
  const col = document.querySelector('#main-content div.max-w-3xl.mx-auto')
           ?? document.querySelector('#main-content div.max-w-2xl.mx-auto');
  if (col) {
    const r = col.getBoundingClientRect();
    if (r.width > 0 && r.left > 0) return r.left;
  }

  // P2: Range probe — finds where text actually renders regardless of container structure.
  const msgEl = document.querySelector(`${SEL.humanTurn}, ${SEL.aiTurn}`);
  if (msgEl) {
    const walker = document.createTreeWalker(msgEl, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    const textNode = walker.nextNode();
    if (textNode) {
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(1, textNode.textContent.length));
      const rects = range.getClientRects();
      if (rects.length) return rects[0].left;
    }
    // P3: Turn element's own left (works when turn IS the column width).
    const r = msgEl.getBoundingClientRect();
    if (r.left > 0) return r.left;
  }

  return null;
}

// Position the badge on the left side of the chat column.
// Always places the badge somewhere visible — either at the precise column position or at
// a sidebar-safe fallback (72px, just right of the typical collapsed sidebar). Never fails
// silently, never causes mode switches, never removes the badge.
function placeLeftCenter() {
  if (!badge?.isLeftCenter) return;

  const gutter   = CONFIG.leftCenterMinGutter ?? 180;
  const chatLeft = findChatContentLeft();

  if (chatLeft !== null && chatLeft >= gutter) {
    const badgeWidth = badge._host.offsetWidth || 200;
    const px = Math.max(8, chatLeft - badgeWidth - 16);
    badge.setHostLeft(px);
    console.debug(`[ccm] placement: chatLeft=${Math.round(chatLeft)} → left=${px}`);
  } else {
    // Column not found or too close to the left edge (sidebar is likely expanded).
    // Park at the sidebar-safe fallback — badge stays visible at the left margin.
    badge.setHostLeft(72);
    console.debug(`[ccm] placement: chatLeft=${chatLeft !== null ? Math.round(chatLeft) : 'null'} → fallback left=72`);
  }
}

// Re-apply left-center placement. Called on resize / layout settle.
// In auto mode the badge is always left-center on wide non-right-panel viewports;
// there is no floating fallback — the badge stays visible at the left edge.
function applyLeftCenterOrFallback() {
  if (!badge) return;
  if (badge.isLeftCenter) {
    placeLeftCenter();
  }
}

// Schedule a two-rAF + 250 ms post-paint settle so placement is re-evaluated once
// the DOM has fully rendered. Handles early-null anchors that appear after first paint.
let _settleTimer = null;
function schedulePostPaintSettle() {
  clearTimeout(_settleTimer);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { applyLeftCenterOrFallback(); });
  });
  _settleTimer = setTimeout(() => applyLeftCenterOrFallback(), 250);
}

// Returns true if a right-side panel is visible (artifact viewer, code preview, etc.)
function isRightPanelOpen() {
  const nodes = document.querySelectorAll(RIGHT_PANEL_SEL);
  return [...nodes].some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left > window.innerWidth * 0.45;
  });
}

// Returns true if the badge should be in header mode in auto placement.
// On wide viewports, 'auto' defaults to header (reliable, always visible).
// Explicit 'left-center' placement bypasses this and always uses left-center.
function shouldCollapseToHeader() {
  if (isNarrow()) return true;
  if (isRightPanelOpen()) return true;
  return true; // auto mode: always prefer header on desktop
}

// Watch the chat column with a ResizeObserver so left-center position stays accurate.
// Always observes document.body so layout shifts are caught even when the column
// anchor was null on first call (early-null, stale selectors, initial render delay).
function startLayoutObserver() {
  layoutObserver?.disconnect();
  const chatEl = findChatColumn();
  layoutObserver = new ResizeObserver(() => checkAutoPlacement());
  if (chatEl) layoutObserver.observe(chatEl);
  layoutObserver.observe(document.body);
}

// Re-evaluate placement for 'auto'/'left-center' mode on layout changes.
// For auto mode on wide viewports: badge stays left-center, repositioned on every layout change.
// On narrow viewports or when a right panel is open: collapse to header (or floating fallback).
function checkAutoPlacement() {
  const pl = state.placement;
  if (pl !== 'auto' && pl !== 'left-center') return;
  if (!badge) return;

  const collapse = shouldCollapseToHeader();

  if (collapse && !headerMode && !autoCollapsed) {
    autoCollapsed = true;
    const old = badge;
    layoutObserver?.disconnect();
    if (tryHeaderPlacement()) {
      old._host?.remove();
    } else {
      autoCollapsed = false;
      placeLeftCenter();
    }
  } else if (!collapse && autoCollapsed && headerMode) {
    // Viewport widened — move back to left-center.
    autoCollapsed = false;
    const old = badge;
    makeFloatingBadge(null, 'left-center');
    old._host?.remove();
    placeLeftCenter();
    startLayoutObserver();
    scheduleScan(100);
  } else if (!headerMode && badge?.isLeftCenter) {
    // Reposition on every layout change (column may have shifted).
    placeLeftCenter();
  }
}

function makeFloatingBadge(savedPosition, mode = 'floating') {
  headerMode = false;
  badge = new Badge({ placement: mode, savedPosition, compact: isNarrow(), ...badgeCallbacks() });
  badge.attachTo(document.documentElement);
}

function initBadge(savedPosition) {
  const pl = state.placement;

  // Explicit header placement (or legacy 'nav').
  if (pl === 'header' || pl === 'nav') {
    if (tryHeaderPlacement()) return;
    makeFloatingBadge(savedPosition);  // fallback if header anchor missing
    return;
  }

  // Explicit floating (bottom-right, draggable).
  if (pl === 'floating') {
    makeFloatingBadge(savedPosition);
    return;
  }

  // 'auto' or 'left-center' — narrow → floating sheet.
  if (isNarrow()) {
    makeFloatingBadge(savedPosition);
    return;
  }
  // 'auto': always try header first (reliable, always visible).
  // 'left-center': skip header, go straight to left-side placement.
  if (pl === 'auto') {
    autoCollapsed = true;
    if (tryHeaderPlacement()) return;
    autoCollapsed = false;
    // Header unavailable — fall back to left-center with sidebar-safe position.
  }
  makeFloatingBadge(savedPosition, 'left-center');
  placeLeftCenter();
  startLayoutObserver();
  schedulePostPaintSettle();
}

// Returns true if the badge was placed in the header.
function tryHeaderPlacement() {
  // On narrow/mobile viewports always use the floating + bottom-sheet layout.
  if (isNarrow()) return false;
  const title  = findTitleEl();
  const header = findHeaderEl();
  if (!title && !header) return false;

  badge = new Badge({ placement: 'header', ...badgeCallbacks() });
  headerMode = true;

  if (title && title.parentElement) {
    // Inline, immediately after the conversation title.
    headerAnchor = title.parentElement;
    title.insertAdjacentElement('afterend', badge._host);
  } else {
    // Header found but no title — pin the host to the header's top-center.
    headerAnchor = header;
    Object.assign(badge._host.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: '200',
    });
    if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
    header.appendChild(badge._host);
  }
  return true;
}

function handleReset() {
  state.isStale = false;
  state.measuredInputTokens = null;
  scan();
}

// Request an authoritative tree fetch from injected.js (main world).
// Sets isRefreshing so the badge shows a spinner until the response arrives.
/**
 * The diagnostics attached to feedback, when the user leaves that box ticked.
 *
 * Everything here describes the METER's state, never the conversation's content.
 * No message text, no title, no conversation id, no URL — none of it is needed to
 * reproduce a metering bug, and the panel renders this object verbatim before
 * anything is sent so the user can check that for themselves.
 */
function feedbackDiagnostics() {
  const b = state.lastBreakdown;
  const out = {
    version:    chrome.runtime.getManifest().version,
    model:      state.modelId ?? 'unknown',
    confirmed:  state.modelConfirmed,
    effort:     state.effort ?? 'none',
    source:     state.treeSource,
    platform:   navigator.platform,
    viewport:   `${window.innerWidth}x${window.innerHeight}`,
  };
  if (b) {
    Object.assign(out, {
      tokenizer:   b.tokenizer,
      window:      b.contextWindow,
      windowOk:    b.windowConfirmed,
      total:       b.total,
      pct:         Math.round(b.pct * 1000) / 10,
      measured:    b.measured,
      compaction:  b.compaction?.state ?? 'unknown',
      turns:       b.messageCount,
    });
  }
  return out;
}

function sendFeedback(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'feedback', payload: { ...payload, source: 'claude-context-meter' } },
      (res) => {
        const err = chrome.runtime.lastError;
        resolve(err ? { ok: false, error: err.message } : (res ?? { ok: false, error: 'No response.' }));
      },
    );
  });
}

function requestUsageFetch(force = true) {
  window.postMessage({ source: 'ccm-content', type: 'usage-fetch', force }, '*');
}

function requestActiveFetch(conversationId) {
  if (!conversationId) return;
  state.isRefreshing = true;
  // Don't reset treeSource if we already have tree data (keep showing it during refresh).
  if (state.treeSource === 'loading' || state.treeSource === 'partial') {
    // stays as-is — no downgrade
  }
  window.postMessage(
    { source: 'ccm-content', type: 'active-tree-fetch', conversationId },
    location.origin,
  );
}

function handleRefresh() {
  requestActiveFetch(state.conversationId);
  requestUsageFetch(true);
  scheduleScan(50);
}

// Re-inject the badge if the header was re-rendered and removed our host.
function checkReinjection() {
  if (!badge) return;
  if (headerMode) {
    if (!document.contains(badge._host)) {
      // Header re-rendered; try to re-place in header, else fall back to floating.
      badge._host.remove();
      badge = null;
      headerAnchor = null;
      if (!tryHeaderPlacement()) {
        makeFloatingBadge();
      }
      scheduleScan(100);
    }
  }
}

// ── Message handler (from injected.js) ───────────────────────────────────────
function onMessage(event) {
  if (event.data?.source !== 'ccm-injected') return;
  const { type, data } = event.data;

  switch (type) {
    case 'request-capture': {
      if (data.model) {
        state.modelId        = resolveModelId(data.model) ?? data.model;
        state.modelConfirmed = true;
        state.isStale        = false;
        retokenizeTreeIfModelChanged();
      }
      // Effort is AUTHORITATIVE from the completion body — map the raw signals
      // (enum string and/or thinking budget) to a Low/Medium/High/Max tier.
      const eff = resolveEffort({ enumStr: data.effortEnum, budget: data.thinkingBudget });
      if (eff) state.effort = eff;
      // A new turn is being sent — reset the in-progress output counter.
      state.liveOutputTokens = 0;
      scheduleScan(200);
      break;
    }

    case 'conversation-data': {
      // Stale response guard: discard if this payload is for a different conversation.
      // Happens when an active fetch from a previous conversation resolves after SPA nav.
      if (data.conversationId && state.conversationId && data.conversationId !== state.conversationId) {
        break;
      }

      if (data.settings) {
        state.activeFeatures = mapSettings(data.settings);
        state.featuresConvId = data.conversationId ?? state.conversationId;
        chrome.storage.local.set({ activeFeatures: state.activeFeatures });
      }
      // ── Fix 1: CONFIRM the model from the tree payload ──────────────────────
      // The active tree fetch is deterministic and authoritative: if the payload
      // carries a model (latest assistant turn, else conversation-level — see
      // injected.js extractConversation / data.modelField), we treat it as
      // confirmed. This is what flips the "?" off on any loaded chat, instead of
      // waiting on the passive /completion intercept which only sometimes fires.
      if (data.model && data.modelFromTree) {
        const resolved = resolveModelId(data.model);
        state.modelId        = resolved ?? data.model;   // keep raw id if unmapped
        state.modelConfirmed = true;
      } else if (data.model && !state.modelConfirmed) {
        // No tree-authority flag (older payload shape) — use it, stay unconfirmed.
        state.modelId = resolveModelId(data.model) ?? data.model;
      }

      // Tokenize the full tree ONCE and cache it (keep raw for re-tokenization).
      if (!data.error) {
        state.treeRaw    = data;
        state.treeCounts = tokenizeTree(data, state.modelId);
        state.treeConvId = data.conversationId;
        state.treeModel  = state.modelId;
        // The refreshed tree now includes the just-finished turn's output, so the
        // live in-progress delta is no longer additive — reset it to avoid double count.
        state.liveOutputTokens = 0;
        state.treeSource   = 'tree';
        state.isRefreshing = false;
        state.isStale      = false;
        persistTally();
      }
      scheduleScan(100);
      break;
    }

    case 'tree-fetch-result': {
      // Active fetch completed with failure (success arrives as 'conversation-data').
      state.isRefreshing = false;
      if (!data.ok) {
        // If we have a cached/fresh tree for this conversation, don't downgrade to partial.
        const haveCachedTree = state.treeCounts && state.treeConvId === state.conversationId;
        if (!haveCachedTree) state.treeSource = 'partial';
        else if (state.treeSource === 'loading') state.treeSource = 'cached';
      }
      scheduleScan(100);
      break;
    }

    case 'project-data': {
      if (data.instructions != null) {
        state.projectInstructionTokens = countFor(String(data.instructions), state.modelId);
      }
      state.projectKnowledgeUnmeasured = (data.docCount ?? 0) > 0;
      scheduleScan(150);
      break;
    }

    case 'usage-update': {
      if (Number.isFinite(data.inputTokens) && data.inputTokens > 0) {
        state.measuredInputTokens = data.inputTokens;
        state.isStale = false; // ground truth supersedes any stale heuristic
      }
      state.liveOutputTokens = data.outputTokens ?? state.liveOutputTokens;
      scheduleScan(120);
      break;
    }

    case 'navigation': {
      handleNavigation();
      break;
    }

    case 'message-limit': {
      // The live SSE fraction is exact where claude.ai's own /usage page rounds.
      state.messageLimit = data;
      chrome.storage.local.set({ lastMessageLimit: data });
      scheduleScan(150);
      break;
    }

    case 'usage-quota': {
      if (data.ok) {
        state.quota = data;
        if (data.unknownShape) {
          // Endpoint responded in a shape we do not recognise. Say nothing in the
          // UI rather than show a number we cannot stand behind.
          console.debug('[ccm] usage endpoint shape unrecognised; keys:', data.unknownShape);
        }
      } else {
        state.quota = { error: data.error ?? `HTTP ${data.status}` };
      }
      scheduleScan(150);
      break;
    }
  }
}

// ── SPA navigation ────────────────────────────────────────────────────────────
function handleNavigation() {
  const newId = extractConvId();
  if (newId !== state.conversationId) {
    state.conversationId = newId;
    state.modelId        = null;
    state.modelConfirmed = false;
    state.effort         = null;
    state.isStale        = false;
    state.prevEstimate   = 0;
    state.treeCounts     = null;
    state.treeRaw        = null;
    state.treeConvId     = null;
    state.treeModel      = null;
    state.measuredInputTokens = null;
    state.liveOutputTokens    = 0;
    state.projectInstructionTokens = 0;
    state.projectKnowledgeUnmeasured = false;
    state.handoff = { status: 'idle', convId: newId, note: '' };
    state.lastBreakdown = null;
    state.treeSource = 'loading';
    state.isRefreshing = false;
    autoCollapsed       = false;
    // fresh page layout
    artifactCache.clear();
    loadCachedTally();   // bridge the pre-fetch window with the last cached tally
    detectModelFromDOM();
    detectEffort();
    watchEffortElement();
    requestActiveFetch(newId);   // deterministic fetch — don't rely on the passive intercept
  }
  checkReinjection();
  maybeUpgradeToHeader();
  if (state.placement === 'auto' || state.placement === 'left-center') {
    startLayoutObserver();
    if (badge?.isLeftCenter) {
      // Already in left-center — reposition for the new page layout.
      if (!placeLeftCenter()) applyLeftCenterOrFallback();
    } else if (!headerMode && !autoCollapsed && !isNarrow()) {
      // Badge is floating (possible prior fallback) — re-attempt left-center on new page.
      const old = badge;
      makeFloatingBadge(null, 'left-center');
      old._host?.remove();
      schedulePostPaintSettle();
    }
  }
  scheduleScan(500);
}

// If we're floating but a header anchor is now available (e.g. booted on a
// non-chat page, then navigated into a chat), move the badge into the header.
// Only applies to explicit 'header'/'nav' placement; 'auto' handles itself via
// checkAutoPlacement().
function maybeUpgradeToHeader() {
  if (headerMode || !state.conversationId) return;
  const wantsHeader = state.placement === 'header' || state.placement === 'nav';
  if (!wantsHeader) return;
  const old = badge;
  if (tryHeaderPlacement()) old?._host?.remove();
}

function extractConvId() {
  const m = window.location.pathname.match(/\/chat\/([^/?]+)/);
  return m ? m[1] : null;
}

// ── Model / effort detection from DOM ──────────────────────────────────────────
function detectModelFromDOM() {
  const btn = document.querySelector(SEL.modelButton);
  if (!btn) return;
  const id = resolveModelId(btn.textContent?.trim() ?? '');
  if (id && !state.modelConfirmed) state.modelId = id;
}

function detectEffort() {
  const e = detectEffortFromDOM();
  // Only update if we got a value AND it's not already locked from a completion payload.
  // (The completion payload is authoritative once the user sends; DOM is pre-send only.)
  if (e) state.effort = e;
}

// Attach a targeted MutationObserver to the effort selector element so we learn
// immediately when the user changes effort level (aria-label or content update).
// Re-called whenever the element might have been re-rendered.
function watchEffortElement() {
  const el = document.querySelector(SEL.effortButton);
  if (!el) return;
  // Already watching this exact element — no-op.
  if (el._ccmWatched) return;
  el._ccmWatched = true;
  if (effortObserver) effortObserver.disconnect();
  effortObserver = new MutationObserver(() => {
    detectEffort();
    scheduleScan(200);
  });
  effortObserver.observe(el, {
    attributes: true,
    attributeFilter: ['aria-label', 'data-value', 'title', 'aria-checked'],
    characterData: true,
    subtree: true,
    childList: true,
  });
}

// ── Per-conversation tally cache (bridge the pre-fetch moment) ──────────────────
function tallyKey() {
  return state.conversationId ? `ccm_tally_${state.conversationId}` : null;
}

function persistTally() {
  const key = tallyKey();
  if (!key) return;
  chrome.storage.local.set({
    [key]: {
      treeCounts:          state.treeCounts,
      measuredInputTokens: state.measuredInputTokens,
      modelId:             state.modelId,
    },
  });
}

function loadCachedTally() {
  const key = tallyKey();
  if (!key) return;
  chrome.storage.local.get([key], (stored) => {
    const t = stored[key];
    if (!t) return;
    // Only use the cache if we haven't already captured fresh tree data.
    if (!state.treeCounts && t.treeCounts) {
      state.treeCounts = t.treeCounts;
      state.treeConvId = state.conversationId;
      // Mark as 'cached' only if a fresh fetch hasn't already resolved.
      if (state.treeSource === 'loading') state.treeSource = 'cached';
    }
    if (state.measuredInputTokens == null && t.measuredInputTokens) {
      state.measuredInputTokens = t.measuredInputTokens;
    }
    if (!state.modelId && t.modelId) state.modelId = t.modelId;
    scheduleScan(50);
  });
}

// ── Scan & update ─────────────────────────────────────────────────────────────
function scheduleScan(delay = 400) {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, delay);
}

// Re-tokenize the cached tree if the model (and thus the multiplier) changed
// since we last counted. No-op when unchanged or no raw payload is held.
function retokenizeTreeIfModelChanged() {
  if (!state.treeRaw) return;
  if (state.treeModel === state.modelId) return;
  state.treeCounts = tokenizeTree(state.treeRaw, state.modelId);
  state.treeModel  = state.modelId;
  persistTally();
}

function scan() {
  // Only track on an actual conversation page (/chat/{id}). Hide elsewhere.
  const onChat = !!state.conversationId;
  badge?.setHidden(!onChat);
  if (!onChat) return;

  if (!state.modelId) detectModelFromDOM();
  ensureTokenizer();
  retokenizeTreeIfModelChanged();

  // Choose counts: prefer the cached tree counts, else scan the DOM.
  const counts = (state.treeCounts && state.treeConvId === state.conversationId)
    ? state.treeCounts
    : tokenizeDOM(state.modelId, artifactCache);

  const measuredTotal = state.measuredInputTokens != null
    ? state.measuredInputTokens + (state.liveOutputTokens ?? 0)
    : null;

  const breakdown = assemble({
    modelId:        state.modelId,
    activeFeatures: state.activeFeatures,
    featuresConfirmed: !!state.conversationId
                       && state.featuresConvId === state.conversationId,
    counts,
    projectOverhead:            state.projectOverhead,
    projectInstructionTokens:   state.projectInstructionTokens,
    projectKnowledgeManual:     state.projectKnowledgeManual,
    projectKnowledgeUnmeasured: state.projectKnowledgeUnmeasured,
    liveOutputTokens:           state.liveOutputTokens,
    measuredTotal,
  });

  // Compaction heuristic on the ESTIMATED total (stable across measured updates).
  if (state.prevEstimate > 15_000 && breakdown.estimatedTotal < state.prevEstimate * 0.5) {
    state.isStale = true;
  }
  state.prevEstimate = breakdown.estimatedTotal;
  state.lastBreakdown = breakdown;

  evaluateHandoff(breakdown);

  badge?.update({
    modelId:        state.modelId,
    modelConfirmed: state.modelConfirmed,
    effort:         state.effort,
    breakdown,
    isStale:        state.isStale && !breakdown.measured,
    handoff:        state.handoff,
    treeSource:     state.treeSource,
    isRefreshing:   state.isRefreshing,
    quota:          state.quota,
    messageLimit:   state.messageLimit,
  });
}

// ── Handoff (context chaining) ──────────────────────────────────────────────────
function evaluateHandoff(breakdown) {
  const ho = CONFIG.handoff;
  const hs = state.handoff;

  // Keep status scoped to the current conversation.
  if (hs.convId !== state.conversationId) {
    state.handoff = { status: 'idle', convId: state.conversationId, note: '' };
  }
  if (!ho?.enabled || !state.conversationId || !state.modelId) return;

  // When code execution is off there is no auto-summarizer, so the window is a
  // hard stop rather than a quality cliff. Same trigger point, louder framing.
  state.handoff.urgent = breakdown.compaction?.state === 'wall';

  // Arm exactly once when we first cross the threshold.
  if (state.handoff.status === 'idle' && breakdown.pct >= (ho.thresholdPct ?? 0.80)) {
    if (ho.autoSend) {
      state.handoff.status = 'requested';
      doHandoffSend();
    } else {
      state.handoff.status = 'armed';
    }
  }
}

// Build the handoff request text and inject it into the composer (or fall back
// to the clipboard if the composer can't be resolved).
function doHandoffSend() {
  const ho = CONFIG.handoff;
  const files = collectFileNames(state.lastBreakdown);
  const filesLine = files
    ? `Files/artifacts already in this conversation (re-attach these in the new chat): ${files}.`
    : '';
  const text = (ho.prompt || '').replace('{{FILES}}', filesLine).trim();

  const sent = insertAndSend(text);
  state.handoff.status = 'requested';
  if (sent) {
    state.handoff.note = 'Handoff requested — when Claude replies, click "Copy handoff".';
  } else {
    // Graceful fallback: hand the user the request text to paste & send.
    navigator.clipboard?.writeText(text).catch(() => {});
    state.handoff.note = 'Composer not found — request copied to clipboard. Paste & send it, then "Copy handoff".';
  }
  scan();
}

function collectFileNames(breakdown) {
  if (!breakdown) return '';
  const names = [
    ...(breakdown.attachmentItems ?? []).map(a => a.name),
    ...(breakdown.artifactItems ?? []).map(a => a.title),
  ].filter(Boolean);
  // De-dupe, cap to keep the message reasonable.
  return [...new Set(names)].slice(0, 30).join(', ');
}

// Composer automation — resilient selectors, paste-first, execCommand fallback.
const COMPOSER_SEL = [
  'div.ProseMirror[contenteditable="true"]',
  '[data-testid="composer"] [contenteditable="true"]',
  'fieldset [contenteditable="true"]',
  'div[contenteditable="true"]',
  'textarea',
].join(', ');

const SEND_SEL = [
  'button[aria-label="Send message" i]',
  'button[data-testid="send-button"]',
  'button[aria-label*="send" i]',
].join(', ');

function findVisible(selector) {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function insertAndSend(text) {
  const editor = findVisible(COMPOSER_SEL);
  if (!editor) return false;

  editor.focus();

  let inserted = false;
  if (editor.tagName === 'TEXTAREA') {
    setNativeTextareaValue(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    inserted = editor.value.includes(text.slice(0, 24));
  } else {
    // contenteditable / ProseMirror — try a synthetic paste first (preserves newlines).
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (_) {}
    if (!editor.textContent?.includes(text.slice(0, 24))) {
      // Fallback: execCommand insertText.
      try { document.execCommand('insertText', false, text); } catch (_) {}
    }
    inserted = (editor.textContent ?? '').includes(text.slice(0, 24));
  }
  if (!inserted) return false;

  // Send after a short tick so React can enable the send button from the input event.
  setTimeout(() => {
    const btn = findVisible(SEND_SEL);
    if (btn && !btn.disabled) {
      btn.click();
    } else {
      editor.focus();
      for (const t of ['keydown', 'keyup']) {
        editor.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }
  }, 80);
  return true;
}

function setNativeTextareaValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
}

// Copy the latest assistant reply's handoff (largest code block, else full text).
function doHandoffCopy() {
  const aiTurns = document.querySelectorAll(SEL.aiTurn);
  const last = aiTurns[aiTurns.length - 1];
  let text = '';
  if (last) {
    const blocks = [...last.querySelectorAll('pre code, pre')];
    if (blocks.length) {
      text = blocks.map(b => b.innerText ?? '').sort((a, b) => b.length - a.length)[0] ?? '';
    }
    if (!text) text = last.innerText ?? '';
  }
  if (!text) {
    state.handoff.note = 'No reply found yet — wait for Claude to finish, then try again.';
    scan();
    return;
  }
  navigator.clipboard?.writeText(text)
    .then(() => { state.handoff.status = 'done'; state.handoff.note = 'Handoff copied ✓ — paste it into a new chat.'; scan(); })
    .catch(() => { state.handoff.note = 'Clipboard blocked — select the reply and copy manually.'; scan(); });
}

// ── VulcanAX session-handoff doc (B) ────────────────────────────────────────────
// The extension fills ONLY the fields it can measure (tokens, %, source, model,
// counts, ids, timestamp). The semantic sections (decisions made, next steps) are
// left as empty, clearly-labeled slots — the extension can't know them without
// fabricating continuity. The operator pastes `chatSideAsk` into the chat and drops
// Claude's reply into the slots. See config.handoffDoc for the (tunable) template.

function getConversationTitle() {
  for (const sel of ['[data-testid="conversation-title"]', '[data-testid="chat-title"]', 'header h1']) {
    const t = document.querySelector(sel)?.textContent?.trim();
    if (t) return t;
  }
  // Fallback: the tab title ("My chat - Claude" → "My chat").
  const dt = (document.title || '').replace(/\s*[-–—]\s*Claude.*$/i, '').trim();
  return dt && dt.toLowerCase() !== 'claude' ? dt : 'Untitled conversation';
}

// Map the current source state to a (label, description) pair for the doc.
function sourceLabelDesc(breakdown) {
  if (breakdown?.measured) return ['measured', 'server token usage (input + live output) — authoritative'];
  switch (state.treeSource) {
    case 'tree':
    case 'loading': return ['tree',    'tokenized from the full conversation payload (estimate)'];
    case 'cached':  return ['cached',  'tally from a previous visit (estimate; hit ↺ to recount)'];
    case 'partial': return ['partial', 'visible DOM only — full tree not yet loaded (rough estimate)'];
    default:        return ['estimated', 'local tokenization of the payload (estimate)'];
  }
}

function hdocSlug() {
  return (getConversationTitle().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project').slice(0, 40);
}

// Assemble the markdown scaffold from config.handoffDoc.template. Returns null if
// we don't yet have a breakdown to report.
function buildHandoffDoc() {
  const b = state.lastBreakdown;
  if (!b) return null;
  const [src, srcDesc] = sourceLabelDesc(b);
  const repl = {
    TITLE:          getConversationTitle(),
    TITLE_SLUG:     hdocSlug(),
    URL:            location.href,
    TIMESTAMP:      new Date().toISOString(),
    MODEL:          modelLabel(state.modelId),
    EFFORT:         effortLabel(state.effort) ?? 'unknown',
    TOTAL:          Math.round(b.total).toLocaleString('en-US'),
    WINDOW:         Math.round(b.contextWindow).toLocaleString('en-US'),
    PCT:            `${Math.round(b.pct * 100)}%`,
    SOURCE:         src,
    SOURCE_DESC:    srcDesc,
    TURNS:          String(b.messageCount ?? 0),
    ATTACH_COUNT:   String(b.attachmentItems?.length ?? 0),
    ARTIFACT_COUNT: String(b.artifactItems?.length ?? 0),
    CONV_ID:        state.conversationId ?? 'unknown',
  };
  return (CONFIG.handoffDoc?.template ?? '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (k in repl ? repl[k] : `{{${k}}}`));
}

async function copyHandoffDoc() {
  const doc = buildHandoffDoc();
  if (!doc) return false;
  try { await navigator.clipboard.writeText(doc); return true; }
  catch (_) { return false; }
}

function downloadHandoffDoc() {
  const doc = buildHandoffDoc();
  if (!doc) return false;
  try {
    const blob = new Blob([doc], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `vulcanax-handoff-${hdocSlug()}.md`;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (_) { return false; }
}

async function copyChatSideAsk() {
  const ask = CONFIG.handoffDoc?.chatSideAsk;
  if (!ask) return false;
  try { await navigator.clipboard.writeText(ask); return true; }
  catch (_) { return false; }
}

// Ask injected.js to re-fetch the tree (debounced). Backstop to the SSE-driven
// refetch — covers turns that finish without a clean completion-stream signal.
let refetchReqTimer = null;
function requestTreeRefetch(delay = 1500) {
  if (!state.conversationId) return;
  clearTimeout(refetchReqTimer);
  refetchReqTimer = setTimeout(() => {
    window.postMessage({ source: 'ccm-content', type: 'refetch-tree', delay: 200 }, location.origin);
  }, delay);
}

// ── MutationObserver ──────────────────────────────────────────────────────────
function startObserver() {
  if (observerInit || !document.body) return;
  observerInit = true;

  new MutationObserver((mutations) => {
    let needsScan      = false;
    let newTurn        = false;
    let layoutChanged  = false;

    for (const m of mutations) {
      if (m.addedNodes.length === 0 && m.removedNodes.length === 0) continue;
      needsScan = true;

      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;

        // Model button appeared → re-detect model + effort.
        if (node.matches?.(SEL.modelButton) || node.querySelector?.(SEL.modelButton)) {
          detectModelFromDOM();
          detectEffort();
          watchEffortElement();
        }

        // Effort selector appeared (could be in composer area, not only near model btn).
        if (node.matches?.(SEL.effortButton) || node.querySelector?.(SEL.effortButton)) {
          detectEffort();
          watchEffortElement();
        }

        // A new conversation turn appeared → ask for a fresh tree count.
        if (node.matches?.(`${SEL.humanTurn}, ${SEL.aiTurn}`) ||
            node.querySelector?.(`${SEL.humanTurn}, ${SEL.aiTurn}`)) {
          newTurn = true;
        }

        // Right-side panels (artifact viewer / code preview) may have appeared.
        if (node.matches?.(RIGHT_PANEL_SEL) ||
            node.querySelector?.(RIGHT_PANEL_SEL)) {
          layoutChanged = true;
        }
      }

      // Nodes removed may mean a right-side panel was closed.
      for (const node of m.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.(RIGHT_PANEL_SEL) ||
            (node.querySelectorAll && node.querySelectorAll(RIGHT_PANEL_SEL).length > 0)) {
          layoutChanged = true;
        }
      }
    }

    checkReinjection();
    if (layoutChanged) checkAutoPlacement();
    if (newTurn && state.conversationId) requestTreeRefetch();
    if (needsScan) scheduleScan();
  }).observe(document.body, { childList: true, subtree: true });
}

// ── Config merge ──────────────────────────────────────────────────────────────
function mergeStoredConfig(stored) {
  if (!stored) return;
  if (stored.baselineTokens !== undefined)         CONFIG.baselineTokens         = stored.baselineTokens;
  if (stored.projectOverhead !== undefined)        state.projectOverhead         = stored.projectOverhead;
  if (stored.projectKnowledgeManual !== undefined) state.projectKnowledgeManual  = stored.projectKnowledgeManual;
  if (stored.imageTokenEstimate !== undefined)     CONFIG.imageTokenEstimate     = stored.imageTokenEstimate;
  if (stored.placement !== undefined)              state.placement               = stored.placement;
  if (stored.autoReExpand !== undefined)           CONFIG.autoReExpand           = stored.autoReExpand;
  if (stored.toolBaselines)  Object.assign(CONFIG.toolBaselines,          stored.toolBaselines);
  if (stored.contextWindows) Object.assign(CONFIG.contextWindows,         stored.contextWindows);
  if (stored.fallbackCharsPerToken) Object.assign(CONFIG.fallbackCharsPerToken, stored.fallbackCharsPerToken);
  if (stored.thresholds)     Object.assign(CONFIG.thresholds,             stored.thresholds);
  if (stored.handoff)        Object.assign(CONFIG.handoff,                stored.handoff);
}
