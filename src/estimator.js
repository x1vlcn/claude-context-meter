/**
 * Token estimation engine.
 *
 * v0.3: the primary token source is the captured conversation tree JSON (relayed
 * from injected.js), which includes prior/virtualized/collapsed turns and closed
 * artifacts — none of which are in the DOM. The legacy DOM scan is retained as a
 * fallback for brand-new chats and the brief pre-fetch window.
 *
 *   tokenizeTree(treeData, modelId)   → counts from captured JSON  (preferred)
 *   tokenizeDOM(modelId, cache)       → counts from rendered DOM    (fallback)
 *   assemble({...counts})             → adds baseline + tools, totals, %
 */

import CONFIG from './config.js';
import { countContent, modelFor } from './ctok/index.js';

// ── DOM selectors ─────────────────────────────────────────────────────────────
// All use stable data-testid or ARIA — never hashed class names.
export const SEL = {
  modelButton: '[data-testid="model-selector-dropdown"]',
  humanTurn:   '[data-testid="human-turn"]',
  aiTurn:      '[data-testid="ai-turn"]',

  // Effort / thinking selector — rendered next to the model selector.
  // Resilient candidate list; we also fall back to scanning the toolbar text.
  effortButton: [
    '[data-testid="thinking-budget-selector"]',
    '[data-testid="effort-selector"]',
    '[data-testid*="effort"]',
    '[data-testid*="thinking"]',
    '[aria-label*="effort" i]',
    '[aria-label*="thinking" i]',
  ].join(', '),

  // File attachments (DOM fallback).
  attachmentCard: [
    '[data-testid*="file-attachment"]',
    '[data-testid*="attachment-card"]',
    '[data-testid*="attachment"]',
  ].join(', '),
  attachmentName: '[data-testid*="file-name"], [data-testid*="attachment-name"], .file-name',
  attachmentSize: '[data-testid*="file-size"], [data-testid*="attachment-size"], .file-size',

  // Artifact side-panel (DOM fallback).
  artifactPanel:   '[data-testid="artifact-content"]',
  artifactTitle:   '[data-testid="artifact-title"], [data-testid="artifact-header"] h1, [data-testid="artifact-header"] h2',

  toolUseBlock: [
    '[data-testid="tool-use-block"]',
    '[data-testid*="tool-call"]',
    '[data-testid*="tool_use"]',
    '[data-testid*="tool-result"]',
    '[data-testid*="search-result-block"]',
    '[data-testid*="code-execution"]',
  ].join(', '),

  compactionBanner: '[data-testid*="compaction"], [data-testid*="summarized"], [class*="CompactionBanner"]',
  collapsedBlock:   '[aria-expanded="false"][data-testid*="tool"], [data-testid*="collapsed-result"]',
};

// Effort keywords scanned for in the DOM effort selector, longest-first so
// "medium" is tested before it could be shadowed. Every word here MUST be a key
// in CONFIG.effort.enumMap so it resolves to a canonical tier (Low/Medium/High/Max).
// Longest-first so 'extra high' is tested before the bare 'high' inside it, and
// 'maximum' before 'max'. Every word here MUST be a key in CONFIG.effort.enumMap
// so it resolves to a canonical tier.
const EFFORT_WORDS = ['extra-high', 'extra high', 'x-high', 'maximum', 'extended',
                      'standard', 'balanced', 'minimal', 'normal', 'medium',
                      'xhigh', 'high', 'max', 'low', 'none'];

// ── Token counting ────────────────────────────────────────────────────────────
//
// Two paths, in strict preference order:
//
//   1. ctok (src/ctok/) — a port of Claude's own tokenizer. Reproduces Anthropic's
//      count_tokens EXACTLY: 5,278/5,278 documents across 501 natural languages and
//      22 programming languages (tools/verify-ctok-parity.mjs). Needs the model's
//      family vocabulary loaded, which content.js does asynchronously whenever the
//      model changes.
//
//   2. A measured chars-per-token ratio — reached only before that fetch resolves,
//      or for a model released after this build. Genuinely an estimate, and
//      labelled `approx` in the panel rather than presented as a measurement.
//
// There is deliberately no third path through a foreign tokenizer. Counting Claude
// text with OpenAI's o200k_base and scaling the result was what this replaced: it
// cost 2.7 MB of bundled vocabulary and was still wrong by 24%-144% depending on
// model and content type.

/**
 * Rough token count from character length. The fallback path — see
 * CONFIG.fallbackCharsPerToken for how the ratios were measured.
 */
export function approxTokens(text, modelId) {
  if (!text) return 0;
  const table = CONFIG.fallbackCharsPerToken ?? {};
  const cpt = table[modelId] ?? table.default ?? 2.6;
  return Math.ceil(text.length / cpt);
}

/**
 * Final token count for `text` under `modelId` — the only counting entry point
 * callers should use. Routes to ctok when its vocabulary is loaded, else to the
 * measured approximation.
 */
export function countFor(text, modelId) {
  if (!text) return 0;
  const model = modelFor(modelId);
  if (model) {
    try {
      return countContent(text, model);
    } catch (_) {
      // A tokenizer fault must never take the meter down; fall through to approx.
    }
  }
  return approxTokens(text, modelId);
}

/** 'exact' when ctok counted this model, 'approx' when the ratio path did. */
export function tokenizerSource(modelId) {
  return modelFor(modelId) ? 'exact' : 'approx';
}

/**
 * Attachment fallback when the payload gives a size but no extracted text. Bytes/4
 * is a crude proxy for an unknown file type and is never exact; the panel marks
 * these rows approximate.
 */
function estimateFromBytes(bytes) {
  return Math.ceil((bytes ?? 0) / (CONFIG.bytesPerToken ?? 4));
}

// ── TREE-sourced counting (preferred) ──────────────────────────────────────────
// treeData is the payload relayed by injected.js (see extractConversation).
// Returns the per-section token counts; this is the heavy step, so content.js
// runs it once per tree fetch and caches the result.
export function tokenizeTree(treeData, modelId) {
  if (!treeData) return null;

  // Per-message breakdown (preferred); fall back to one concatenated string.
  let messageItems = [];
  let conversation;
  if (Array.isArray(treeData.messages) && treeData.messages.length) {
    messageItems = treeData.messages.map((m, i) => ({
      idx:    i + 1,
      role:   m.role === 'assistant' ? 'assistant' : 'human',
      tokens: countFor(m.text ?? '', modelId),
    }));
    conversation = messageItems.reduce((s, m) => s + m.tokens, 0);
  } else {
    conversation = countFor(treeData.conversationText ?? '', modelId);
  }

  // Attachments — extracted_content is the real in-context text; else bytes/4.
  const attachmentItems = (treeData.attachments ?? []).map((a) => {
    const tokens = a.text != null ? countFor(a.text, modelId)
                                  : estimateFromBytes(a.bytes);
    return { name: a.name ?? 'Attachment', sizeText: fmtBytes(a.bytes), tokens };
  });

  // Images — flat per-image estimate (no dimensions in payload). Not multiplied
  // (image tokens are not text tokens).
  const imageCount  = treeData.imageCount ?? (treeData.images?.length ?? 0);
  const imageTokens = imageCount * CONFIG.imageTokenEstimate;
  for (const img of (treeData.images ?? [])) {
    attachmentItems.push({ name: img.name ?? 'image', sizeText: `${img.kind ?? 'image'} (est)`, tokens: CONFIG.imageTokenEstimate });
  }

  const files = attachmentItems.reduce((s, a) => s + a.tokens, 0);

  // Artifacts — bodies pulled from tool_use(name:"artifacts"); counted once.
  const artifactItems = (treeData.artifacts ?? []).map((art) => ({
    title:  art.title ?? 'Artifact',
    tokens: countFor(art.text ?? '', modelId),
    open:   false,
    fromTree: true,
  }));
  const artifacts = artifactItems.reduce((s, a) => s + a.tokens, 0);

  return {
    conversation,
    files,
    artifacts,
    imageTokens,
    imageCount,
    attachmentItems,
    artifactItems,
    messageItems,
    messageCount:   treeData.messageCount ?? messageItems.length,
    humanCount:     treeData.humanCount ?? 0,
    assistantCount: treeData.assistantCount ?? 0,
    measured:       !!treeData.measured,
    measuredTokens: treeData.measuredTokens ?? null,
    source: 'tree',
  };
}

// ── DOM-sourced counting (fallback) ─────────────────────────────────────────────
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\b/i;

export function enumerateAttachments() {
  const items = [];
  const seen  = new Set();

  document.querySelectorAll(SEL.attachmentCard).forEach((card) => {
    const text = card.textContent ?? '';
    const key  = text.slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    const nameEl = card.querySelector(SEL.attachmentName);
    let name = nameEl?.textContent?.trim() ?? '';

    const sizeEl  = card.querySelector(SEL.attachmentSize);
    const sizeStr = (sizeEl?.textContent ?? text).trim();
    const m       = sizeStr.match(SIZE_RE) ?? text.match(SIZE_RE);

    if (!m && !name) return;

    let bytes = 0;
    let sizeText = '?';
    if (m) {
      const value = parseFloat(m[1]);
      const unit  = m[2].toUpperCase();
      bytes = unit === 'GB' ? value * 1e9
            : unit === 'MB' ? value * 1e6
            : unit === 'KB' ? value * 1e3
            : value;
      sizeText = `${m[1]} ${m[2]}`;
    }

    if (!name) {
      name = text.split('\n').map(s => s.trim()).find(s => s && !SIZE_RE.test(s)) ?? 'Attachment';
    }
    name = name.slice(0, 40);

    items.push({ name, sizeText, bytes });
  });

  return items;
}

export function tokenizeDOM(modelId, artifactCache) {
  // Conversation turns — query both in one selector to preserve document order.
  const turns = [...document.querySelectorAll(`${SEL.humanTurn}, ${SEL.aiTurn}`)];
  const messageItems = [];
  let conversation = 0;
  if (turns.length > 0) {
    turns.forEach((el, i) => {
      const tokens = countFor(el.innerText ?? '', modelId);
      const role = el.matches(SEL.humanTurn) ? 'human' : 'assistant';
      messageItems.push({ idx: i + 1, role, tokens });
      conversation += tokens;
    });
  } else {
    const main = document.querySelector('main') ?? document.body;
    conversation = countFor(main?.innerText ?? '', modelId);
  }

  // Attachments
  const attachmentItems = enumerateAttachments().map((a) => ({
    name: a.name, sizeText: a.sizeText, tokens: estimateFromBytes(a.bytes),
  }));
  const files = attachmentItems.reduce((s, a) => s + a.tokens, 0);

  // Artifacts (live open panels + cached closed)
  const artifactItems = [];
  const seenIds = new Set();
  document.querySelectorAll(SEL.artifactPanel).forEach((el, idx) => {
    const titleEl = el.querySelector(SEL.artifactTitle);
    const title   = titleEl?.textContent?.trim()?.slice(0, 40) ?? `Artifact ${idx + 1}`;
    const tokens  = countFor(el.innerText ?? '', modelId);
    const key     = `live_${idx}`;
    seenIds.add(key);
    artifactItems.push({ title, tokens, open: true, key });
  });
  if (artifactCache) {
    for (const [key, entry] of artifactCache) {
      if (seenIds.has(key)) continue;
      artifactItems.push({ title: entry.title, tokens: entry.tokens, open: false, key });
    }
  }
  const artifacts = artifactItems.reduce((s, a) => s + a.tokens, 0);

  return {
    conversation,
    files,
    artifacts,
    imageTokens: 0,
    imageCount: 0,
    attachmentItems,
    artifactItems,
    messageItems,
    messageCount: messageItems.length,
    measured: false,
    measuredTokens: null,
    source: 'dom',
  };
}

export function countInvokedTools() {
  try { return document.querySelectorAll(SEL.toolUseBlock).length; }
  catch (_) { return 0; }
}

// ── Undercount detection (DOM mode mainly) ──────────────────────────────────────
export function detectUndercountReasons({ source, artifactItems }) {
  const reasons = [];

  if (source === 'dom') {
    const closedCount = artifactItems?.filter(a => !a.open).length ?? 0;
    if (closedCount > 0) reasons.push(`${closedCount} artifact${closedCount > 1 ? 's' : ''} closed (cached)`);
    if (document.querySelector(SEL.compactionBanner)) reasons.push('conversation compacted by server');
    const collapsed = document.querySelectorAll(SEL.collapsedBlock).length;
    if (collapsed > 0) reasons.push(`${collapsed} collapsed tool result${collapsed > 1 ? 's' : ''}`);
    reasons.push('counting visible DOM only — open the chat fully for tree-based counts');
  }
  return reasons;
}

// ── Assembler ───────────────────────────────────────────────────────────────────
// Combines a counts object (from tokenizeTree or tokenizeDOM) with baseline,
// tool overhead, project instructions, and the measured streaming total.
/**
 * Will this conversation auto-summarize when it fills, or hit a hard wall?
 *
 * Anthropic: "Code execution must be enabled for automatic context management to
 * work." We already know whether code execution is on (it is one of the feature
 * flags we read for its token cost), so the answer costs nothing extra — and it
 * changes what running out of window MEANS for the user.
 *
 * `activeFeatures == null` means conversation settings have not arrived yet; that
 * is reported as unknown rather than guessed either way.
 */
export function predictCompaction(activeFeatures) {
  const c = CONFIG.compaction ?? {};
  if (!c.requiresCodeExecution) {
    return { state: 'will', willAutoCompact: true, label: c.labelWillCompact, note: c.noteWillCompact };
  }
  if (activeFeatures == null) {
    return { state: 'unknown', willAutoCompact: null, label: null, note: c.noteUnknown };
  }
  return activeFeatures.codeExecution
    ? { state: 'will', willAutoCompact: true,  label: c.labelWillCompact, note: c.noteWillCompact }
    : { state: 'wall', willAutoCompact: false, label: c.labelHardWall,    note: c.noteHardWall };
}

export function assemble({
  modelId,
  activeFeatures,
  // True only when `activeFeatures` came from the conversation currently on
  // screen. Feature flags are per-conversation and we cache the last set we saw,
  // which is fine for approximating token cost but NOT for the compaction claim:
  // asserting "this chat will hit a hard wall" on another chat's settings would be
  // worse than saying nothing.
  featuresConfirmed = false,
  counts,
  projectOverhead = 0,         // manual fallback for custom instructions
  projectInstructionTokens = 0, // measured from project endpoint (preferred)
  projectKnowledgeManual = 0,
  projectKnowledgeUnmeasured = false,
  liveOutputTokens = 0,         // in-progress streaming output (estimate mode)
  measuredTotal = null,         // ground-truth context size from SSE input_tokens
}) {
  const contextWindow = CONFIG.contextWindows[modelId] ?? CONFIG.contextWindows.default;
  // A model we have not confirmed a chat window for still gets a number to divide
  // by, but the panel must say so rather than imply the percentage is solid.
  const windowConfirmed = (CONFIG.confirmedWindowModels ?? []).includes(modelId);
  const compaction = predictCompaction(featuresConfirmed ? activeFeatures : null);

  // Baseline = base system prompt + project custom instructions (measured or manual)
  const projInstr = projectInstructionTokens > 0 ? projectInstructionTokens : projectOverhead;
  const baseline = CONFIG.baselineTokens + projInstr;

  // Tool / feature overhead
  const featureDetails = [];
  let tools = 0;
  const af = activeFeatures ?? {};
  function addFeature(key, label, cost) {
    const active = !!af[key];
    featureDetails.push({ label, cost, active });
    if (active) tools += cost;
  }
  addFeature('artifacts',          'Artifacts tool def', CONFIG.toolBaselines.artifacts);
  addFeature('webSearch',          'Web search',    CONFIG.toolBaselines.webSearch + CONFIG.toolBaselines.webSearchCitation);
  addFeature('codeExecution',      'Code execution', CONFIG.toolBaselines.codeExecution);
  addFeature('memory',             'Memory',        CONFIG.toolBaselines.memory);
  addFeature('memorySearch',       'Memory search', CONFIG.toolBaselines.memorySearch);
  addFeature('profilePreferences', 'Profile prefs', CONFIG.toolBaselines.profilePreferences);
  if (af.mcpCount) {
    const mcpCost = af.mcpCount * CONFIG.toolBaselines.mcpConnector;
    featureDetails.push({ label: `MCP (×${af.mcpCount})`, cost: mcpCost, active: true });
    tools += mcpCost;
  }

  const c = counts ?? {};
  const conversation = c.conversation ?? 0;
  const files        = c.files ?? 0;
  const artifacts    = c.artifacts ?? 0;

  const estimatedTotal =
    baseline + tools + conversation + files + artifacts + projectKnowledgeManual + (liveOutputTokens || 0);

  // Prefer the ground-truth measured total when available.
  const usingMeasured = Number.isFinite(measuredTotal) && measuredTotal > 0;
  const total = usingMeasured ? measuredTotal : estimatedTotal;
  const pct   = Math.min(total / contextWindow, 1.0);

  const undercountReasons = detectUndercountReasons({ source: c.source, artifactItems: c.artifactItems });

  return {
    source: usingMeasured ? 'measured' : (c.source === 'tree' ? 'tree-estimated' : 'dom-estimated'),
    measured: usingMeasured,
    estimatedTotal,
    measuredTotal: usingMeasured ? measuredTotal : null,

    baseline,
    projectInstructionTokens: projInstr,
    projectInstructionMeasured: projectInstructionTokens > 0,
    projectKnowledgeManual,
    projectKnowledgeUnmeasured,

    tools,
    featureDetails,
    conversation,
    files,
    artifacts,

    attachmentItems: c.attachmentItems ?? [],
    artifactItems:   c.artifactItems ?? [],
    messageItems:    c.messageItems ?? [],
    imageCount:      c.imageCount ?? 0,
    messageCount:    c.messageCount ?? 0,
    invokedToolCount: countInvokedTools(),

    undercountReasons,
    total,
    contextWindow,
    windowConfirmed,
    compaction,
    // 'exact' when ctok counted the text, 'approx' when the o200k+scalar fallback did.
    tokenizer: tokenizerSource(modelId),
    pct,
  };
}

// ── Model name resolution ─────────────────────────────────────────────────────
export function resolveModelId(displayText) {
  if (!displayText) return null;
  const t = displayText.trim();

  if (CONFIG.modelDisplayNames[t]) return CONFIG.modelDisplayNames[t];

  const lower = t.toLowerCase();
  for (const [display, id] of Object.entries(CONFIG.modelDisplayNames)) {
    if (lower.includes(display.toLowerCase())) return id;
  }
  for (const id of Object.keys(CONFIG.contextWindows)) {
    if (id !== 'default' && lower.includes(id)) return id;
  }
  return null;
}

// Canonical model ID → display label. Explicit map first, then a safe
// title-case fallback that converts version dashes to dots (never spaces).
export function modelLabel(modelId) {
  if (!modelId) return 'Unknown';
  if (CONFIG.modelLabels[modelId]) return CONFIG.modelLabels[modelId];
  return modelId
    .replace(/^claude-/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')      // ...-4-8  → " 4.8"
    .replace(/-(\d+)(?=\b)/g, ' $1')         // trailing single version segment
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// ── Effort resolution (4-tier: Low / Medium / High / Max) ───────────────────────
// Single mapping point for every effort source. Returns a canonical tier
// ('low'|'medium'|'high'|'max'), or — when a raw value matches nothing — the raw
// value itself (lowercased), so the badge shows the truth instead of a wrong label.
//
//   resolveEffort({ enumStr })  — from the /completion body's effort enum (preferred)
//   resolveEffort({ budget })   — from thinking.budget_tokens (no enum present)
//   resolveEffort({ domWord })  — from the visible composer selector (fallback)
export function resolveEffort({ enumStr = null, budget = null, domWord = null } = {}) {
  const cfg = CONFIG.effort ?? {};
  const enumMap = cfg.enumMap ?? {};

  // 1. Explicit enum string (or DOM keyword) — map through the alias table.
  for (const raw of [enumStr, domWord]) {
    if (typeof raw === 'string' && raw.trim()) {
      const key = raw.trim().toLowerCase();
      if (enumMap[key]) return enumMap[key];
      // Real tier name slipped through verbatim?
      if ((cfg.levels ?? []).includes(key)) return key;
      // Unmappable but real: surface the raw value rather than a wrong label.
      if (enumStr === raw) return key;
    }
  }

  // 2. Thinking budget band.
  if (Number.isFinite(budget)) {
    for (const band of (cfg.budgetThresholds ?? [])) {
      if (budget >= band.min) return band.level;
    }
  }

  return null;
}

// Canonical tier → display label ("high" → "High"). Unknown/raw values are
// title-cased so an unmapped raw enum still renders legibly.
export function effortLabel(level) {
  if (!level) return null;
  const labels = CONFIG.effort?.labels ?? {};
  if (labels[level]) return labels[level];
  const s = String(level);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// DOM selector for the composer / send-button area (effort selector lives here,
// not only near the model dropdown in the header). Resilient candidate list.
const COMPOSER_CANDIDATES = [
  '[data-testid="composer"]',
  '[data-testid="chat-composer"]',
  'fieldset',
  'form[aria-label]',
  '[role="region"][aria-label*="chat" i]',
  '[role="region"][aria-label*="message" i]',
];

// Detect the current effort tier from the DOM.
// Priority: (1) direct match on SEL.effortButton, (2) composer area scan,
// (3) header/nav area scan near the model selector.
//
// The effort selector in claude.ai is rendered inside the composer bottom-toolbar
// (the same row as the send button), NOT always near the model selector.
// DOM selector path reported: SEL.effortButton candidates first, then scoped
// composer-area scan for buttons/spans that contain an effort keyword.
export function detectEffortFromDOM() {
  // 1. Direct match — fastest; works when data-testid is stable.
  const el = document.querySelector(SEL.effortButton);
  if (el) {
    const word = matchEffortWord(el.getAttribute('aria-label') ?? el.textContent ?? '');
    if (word) return resolveEffort({ domWord: word });
  }

  // 2. Composer area scan — effort selector is in the send-button row, not the header.
  for (const sel of COMPOSER_CANDIDATES) {
    const area = document.querySelector(sel);
    if (!area) continue;
    for (const node of area.querySelectorAll('button, [role="button"], span, [aria-label]')) {
      const word = matchEffortWord(node.getAttribute('aria-label') ?? node.textContent ?? '');
      if (word) return resolveEffort({ domWord: word });
    }
  }

  // 3. Fallback: scan elements near the model selector (header / top-nav toolbar).
  const model = document.querySelector(SEL.modelButton);
  const scope = model?.closest('header, nav, [role="banner"]') ?? document.body;
  for (const node of scope.querySelectorAll('button, [role="button"], [aria-label]')) {
    const word = matchEffortWord(node.getAttribute('aria-label') ?? node.textContent ?? '');
    if (word) return resolveEffort({ domWord: word });
  }
  return null;
}

function matchEffortWord(text) {
  const lower = (text ?? '').toLowerCase();
  for (const w of EFFORT_WORDS) {
    // Word-boundary match so "Medium" doesn't match inside unrelated copy.
    if (new RegExp(`\\b${w}\\b`).test(lower)) return w;
  }
  return null;
}

// Map raw claude.ai `settings` flags to our feature keys.
export function mapSettings(settings) {
  return {
    artifacts:          !!(settings.enabled_artifacts_attachments || settings.preview_feature_uses_artifacts),
    webSearch:          !!settings.enabled_web_search,
    codeExecution:      !!settings.enabled_monkeys_in_a_barrel,
    memory:             !!(settings.enabled_saffron || settings.enabled_saffron_search),
    memorySearch:       !!settings.enabled_saffron_search,
    profilePreferences: !!settings.profile_preferences,
    mcpCount:           0,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────────
function fmtBytes(bytes) {
  if (!bytes) return '';
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}
