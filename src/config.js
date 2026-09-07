/**
 * Claude Context Meter — Central Configuration
 *
 * ALL tunable constants live here. Options page reads and writes this shape
 * to chrome.storage.local under the key "config"; content.js merges on load.
 *
 * WHY lines cite the empirical source for every number so future calibration
 * has an audit trail instead of guesswork.
 */

const CONFIG = {

  // ── BASELINE ──────────────────────────────────────────────────────────────
  // System prompt + always-on tool defs loaded before any user message.
  //
  // WHY 28,000: Piebald-AI/claude-code-system-prompts (Jun 2026) measured
  // 27–30k tokens for the full claude.ai base system prompt via Anthropic's
  // count_tokens API. lugia19 uses only 3,200 (the user-visible portion);
  // our 28k covers the full server-side load including hidden tool defs.
  baselineTokens: 28_000,

  // Additional overhead for project-level custom instructions (style/persona/tools).
  // These are NOT counted in baselineTokens because they vary per project.
  // Used as a FALLBACK only — when the project endpoint exposes the instruction
  // text (captured via the fetch hook) we tokenize it directly instead.
  // WHY 0 default: unknown per user; must be set manually.
  projectOverhead: 0,

  // Manual estimate for Project Knowledge (RAG-retrieved docs).
  // WHY a separate manual field: Project Knowledge is retrieved per-turn by
  // relevance — only the retrieved chunks enter context, and the payload does
  // NOT expose which/how many. We therefore CANNOT measure it. Default 0 and the
  // panel labels it "unmeasured" rather than silently folding an unknown in.
  projectKnowledgeManual: 0,

  // Per-image token estimate. claude.ai sizes images by dimensions
  // (~(w·h)/750, capped near 1,600); we don't get dimensions from the tree, so
  // we use a flat conservative estimate and label it approximate.
  imageTokenEstimate: 1_600,

  // Bytes→tokens divisor for an attachment whose extracted text we never receive
  // (we know its size and nothing else). Distinct from fallbackCharsPerToken: that
  // one prices TEXT we can read, this one prices a file we cannot. Deliberately
  // left at the generic 4 — the content type is unknown, so a tokenizer-specific
  // ratio would imply precision that isn't there. Such rows are marked approximate.
  bytesPerToken: 4,

  // Additive per-feature overhead when that feature is active in the conversation.
  // Values from lugia19/Claude-Usage-Extension FEATURE_COSTS, measured against
  // Anthropic's token-counting API (Jun 2026). Internal feature codenames noted.
  toolBaselines: {
    // WHY 2200: lugia19 `enabled_artifacts_attachments` = 2,200.
    artifacts:           2_200,
    // WHY 10250: lugia19 `enabled_web_search` = 10,250. Large because the tool
    // definition includes a search context header + instructions block.
    webSearch:          10_250,
    // WHY 450: lugia19 `citation_info` always appended alongside web search.
    webSearchCitation:     450,
    // WHY 5300: lugia19 `enabled_monkeys_in_a_barrel` (code execution) = 5,300.
    codeExecution:       5_300,
    // WHY 4250: lugia19 `enabled_saffron` (memory feature) = 4,250.
    memory:              4_250,
    // WHY 3000: lugia19 `enabled_saffron_search` (memory search sub-feature) = 3,000.
    memorySearch:        3_000,
    // WHY 850: lugia19 `profile_preferences` = 850.
    profilePreferences:    850,
    // Per MCP connector tool definition (our estimate; varies by connector).
    mcpConnector:        1_000,
  },

  // ── CONTEXT WINDOWS ───────────────────────────────────────────────────────
  // claude.ai CHAT plan window sizes. These are per-SURFACE: the same model gets a
  // different window in Claude Code and in Cowork. We only run on the chat surface,
  // so these are the chat numbers.
  //
  // Source (verified 2026-08-23): support.claude.com/en/articles/8606394
  //   "Claude Opus 5 and Sonnet 5 support a 1M token context window on all paid
  //    plans when chatting with Claude."
  //   "Claude Opus 4.8, Opus 4.7, Opus 4.6, and Sonnet 4.6 support a 500K token
  //    context window on all paid plans."
  //   "Outside of these models, Claude's context window size is 200K."
  //
  // WHY this matters more than any other constant here: an absent model falls to
  // `default` (200k). Before Aug 2026 this table had no Opus 5 / Sonnet 5 entry, so
  // the meter divided a 1M window by 200k and read FIVE TIMES too full on the
  // default model — firing the handoff offer at ~16% of the real window.
  contextWindows: {
    'claude-opus-5':      1_000_000,
    'claude-sonnet-5':    1_000_000,
    'claude-opus-4-8':      500_000,
    'claude-opus-4-7':      500_000,
    'claude-opus-4-6':      500_000,
    'claude-sonnet-4-6':    500_000,
    'claude-haiku-4-5':     200_000,
    // Fable 5 and Mythos 5 are listed for Claude Code and Cowork but NOT in the
    // chat list, and Mythos 5 is invitation-only (Project Glasswing). Whether
    // either is selectable in claude.ai chat at all is unverified, so both are
    // deliberately absent: an absent model renders as "unconfirmed", which is
    // honest, where a guessed number is silently wrong. (The previous
    // 'claude-fable-5': 500_000 entry was a guess, and its "Suspended Jun 2026"
    // note was wrong — Fable 5 is a current model.)
    default:                200_000, // Unknown model — badge surfaces "unconfirmed"
  },

  // Models whose chat window is confirmed against the support article above.
  // Anything outside this set keeps the "unconfirmed window" note in the panel even
  // though `default` supplies a number to divide by.
  confirmedWindowModels: [
    'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7',
    'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  ],

  // ── FALLBACK TOKEN ESTIMATE ──────────────────────────────────────────────
  // Counting normally goes through src/ctok/, which reproduces Claude's own token
  // counts EXACTLY (5,278/5,278 upstream documents — tools/verify-ctok-parity.mjs).
  // This table is only reached in two situations:
  //
  //   a. the few hundred milliseconds between page load and the model's vocabulary
  //      finishing its fetch (the badge shows "loading" and a ~ prefix throughout);
  //   b. a model with no ctok family — i.e. one released after this build.
  //
  // WHY chars-per-token and not the old o200k multiplier: the previous fallback
  // bundled OpenAI's o200k_base tokenizer (2.7 MB of vocabulary) and multiplied its
  // output by a guessed constant. Since ctok now counts every model we support, a
  // 2.7 MB dependency to serve a sub-second window was the single largest thing in
  // the extension. It is gone; these ratios replace it.
  //
  // WHY these numbers: measured with ctok itself over the upstream corpora
  // (tools/measure-fallback-ratio.mjs), chars per token —
  //
  //     family    English prose   source code   shipped (geometric mean)
  //     v4.7/v5       3.485          2.049          2.6
  //     v3            5.071          2.476          3.4
  //
  // The geometric mean brackets prose and code because chat is a mix of both. It
  // rounds slightly toward the code (denser) end on purpose: over-estimating how
  // full the window is fails safe, while under-estimating walks the user into a
  // limit they were told they had room before.
  fallbackCharsPerToken: {
    'claude-opus-5':     2.6,
    'claude-sonnet-5':   2.6,
    'claude-opus-4-8':   2.6,
    'claude-opus-4-7':   2.6,
    'claude-fable-5':    2.6,
    'claude-mythos-5':   2.6,
    'claude-opus-4-6':   3.4,
    'claude-sonnet-4-6': 3.4,
    'claude-haiku-4-5':  3.4,
    // Unknown model: assume the newer, denser tokenizer. A new model is far more
    // likely to use the current one than the pre-4.7 one.
    default:             2.6,
  },

  // claude.ai UI display names → canonical API model IDs.
  modelDisplayNames: {
    'Claude Opus 5':      'claude-opus-5',
    'Claude Sonnet 5':    'claude-sonnet-5',
    'Claude Mythos 5':    'claude-mythos-5',
    'Claude Opus 4.8':    'claude-opus-4-8',
    'Claude Opus 4.7':    'claude-opus-4-7',
    'Claude Opus 4.6':    'claude-opus-4-6',
    'Claude Sonnet 4.6':  'claude-sonnet-4-6',
    'Claude Haiku 4.5':   'claude-haiku-4-5',
    'Claude Fable 5':     'claude-fable-5',
    'Opus 5':             'claude-opus-5',
    'Sonnet 5':           'claude-sonnet-5',
    'Mythos 5':           'claude-mythos-5',
    'Opus 4.8':           'claude-opus-4-8',
    'Opus 4.7':           'claude-opus-4-7',
    'Opus 4.6':           'claude-opus-4-6',
    'Sonnet 4.6':         'claude-sonnet-4-6',
    'Haiku 4.5':          'claude-haiku-4-5',
    'Fable 5':            'claude-fable-5',
    'opus-5':             'claude-opus-5',
    'sonnet-5':           'claude-sonnet-5',
    'fable-5':            'claude-fable-5',
    'mythos-5':           'claude-mythos-5',
    'opus-4-8':           'claude-opus-4-8',
    'opus-4-7':           'claude-opus-4-7',
    'opus-4-6':           'claude-opus-4-6',
    'sonnet-4-6':         'claude-sonnet-4-6',
    'haiku-4-5':          'claude-haiku-4-5',
  },

  // Canonical model ID → human display label (used in the badge).
  // WHY explicit map: the old formatter turned "claude-opus-4-8" into "Opus 4 8"
  // by replacing -<digit> with a space. Version numbers must render with dots.
  // Unknown IDs fall back to safe title-case (dashes→dots, never spaces).
  modelLabels: {
    'claude-opus-5':     'Opus 5',
    'claude-sonnet-5':   'Sonnet 5',
    'claude-mythos-5':   'Mythos 5',
    'claude-opus-4-8':   'Opus 4.8',
    'claude-opus-4-7':   'Opus 4.7',
    'claude-opus-4-6':   'Opus 4.6',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-haiku-4-5':  'Haiku 4.5',
    'claude-fable-5':    'Fable 5',
  },

  // ── EFFORT (reasoning-effort tier) ───────────────────────────────────────
  // FIVE tiers, low -> max (corrected Aug 2026):
  //   Low - Medium - High - XHigh - Max
  //
  // WHY the correction: `xhigh` shipped with Opus 4.7, sits between `high` and
  // `max`, and is Claude Code's default — but this table listed only four tiers, so
  // a turn sent at xhigh fell through every branch and rendered as a raw string.
  //
  // Source priority (see content.js detectEffort / onMessage 'request-capture'):
  //   1. The /completion request body — AUTHORITATIVE, it carries the effort the
  //      turn was actually sent with. Read `output_config.effort` FIRST: effort
  //      moved inside `output_config` and is no longer a top-level field. The
  //      top-level probe is retained only for older payload shapes.
  //   2. The visible composer effort selector in the DOM — used before any turn
  //      has been sent.
  //
  // If a raw value matches neither an enum alias nor a budget band, content.js
  // surfaces the RAW value rather than inventing a friendly label.
  effort: {
    // Canonical tiers, low->high. `null`/unknown renders no effort segment.
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],

    // Raw effort enum string (lowercased) -> canonical tier. Direct identity for
    // the five real tiers; the rest are defensive aliases for historical encodings
    // so a stale value degrades to the nearest real tier instead of rendering raw.
    enumMap: {
      low:      'low',
      medium:   'medium',
      high:     'high',
      xhigh:    'xhigh',
      max:      'max',
      // alternate spellings of xhigh seen in DOM copy
      'x-high':      'xhigh',
      'extra high':  'xhigh',
      'extra-high':  'xhigh',
      // legacy / alternate encodings (nearest real tier, never invented):
      none:     'low',
      minimal:  'low',
      standard: 'medium',
      normal:   'medium',
      default:  'medium',
      balanced: 'medium',
      extended: 'high',
      maximum:  'max',
      ultra:    'max',
    },

    // DEAD PATH on every current model — retained only for pre-4.6 conversations.
    //
    // `thinking.budget_tokens` was REMOVED from the API: it returns HTTP 400 on
    // Fable 5, Opus 5, Sonnet 5, Opus 4.8 and Opus 4.7, and is deprecated on
    // Opus 4.6 / Sonnet 4.6. Current turns send `thinking: {type: "adaptive"}`,
    // which carries no budget at all, so nothing here can fire for them. Effort
    // must come from the enum. Bands are lower bounds, evaluated high->low.
    budgetThresholds: [
      { min: 24_000, level: 'max' },
      { min: 12_000, level: 'high' },
      { min: 1_000,  level: 'medium' },
      { min: 0,      level: 'low' },
    ],

    // Canonical tier -> display label shown in the badge/panel.
    labels: { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' },
  },

  // ── BRAND (VulcanAX Performance / dark) ───────────────────────────────────
  // The meter's OWN UI only (shadow DOM). NOT applied to claude.ai's interface —
  // that is the separate, parked brand-skin extension. Every value is surfaced as
  // a CSS custom property on the badge's shadow root (see badge.js brandVars()).
  //
  // Accent rule: EMBER is the primary accent (healthy bar, active/hover, % text,
  // refresh icon). RED is RESTRICTED — danger threshold + error states only, plus
  // the single sanctioned identity use: the "X" of the AX mark. Never pure #000/#fff.
  brand: {
    surfaceBg:    '#0A0A0B',  // outermost surface (compact pill bg base)
    panelSurface: '#111113',  // drill-down panel surface
    nestedRow:    '#18181B',  // nested rows / hover wells
    border:       'rgba(255,255,255,0.08)',
    borderHeavy:  'rgba(255,255,255,0.14)',
    textPrimary:  '#F5F5F7',  // cream — also the AX mark "A" body (currentColor)
    textMuted:    '#A1A1AA',
    textDim:      '#6B6B72',
    accentEmber:  '#FF7A2D',  // PRIMARY accent
    warnAmber:    '#f59e0b',  // bar progression: ember → amber → red
    dangerRed:    '#E8232A',  // RESTRICTED: danger threshold + errors + AX "X"
    positive:     '#4ADE80',  // ONLY for a positive delta / authoritative-good state
    axRed:        '#E8232A',  // the AX mark "X" — the one identity use of red

    // Optional DM Sans for numeric labels/metadata, loaded via a Google Fonts
    // <link> (MV3-safe, no remote code). OFF by default: claude.ai's CSP can
    // block the stylesheet, and the system font is perfectly adequate for a
    // utility widget. Flip to true in Options to opt in.
    useDMSans: false,
  },

  // ── AUTO CONTEXT MANAGEMENT (compaction prediction) ──────────────────────
  // claude.ai summarizes earlier turns as a conversation nears the window — but
  // ONLY under a precondition most users do not know about:
  //
  //   "Code execution must be enabled for automatic context management to work."
  //   -- support.claude.com/en/articles/11647753 (verified 2026-08-23)
  //
  // That single sentence changes what the end of the window MEANS:
  //   code execution ON  -> the conversation summarizes and continues. Running out
  //                         is a quality event (early turns get lossy), not a stop.
  //   code execution OFF -> there is no summarizer. The conversation hits a HARD
  //                         WALL at the window and the user must start a new chat.
  //
  // We already detect code execution for its token cost (toolBaselines.codeExecution
  // via the `enabled_monkeys_in_a_barrel` settings flag), so this prediction is free
  // — no extra request, no extra permission. It is the one thing the meter can tell
  // a user that no other context meter does.
  //
  // The same article notes "rare edge cases (such as very large first messages) may
  // still encounter context limits", so even the ON case is not an absolute promise;
  // the wording below says "should" rather than "will".
  compaction: {
    // Gate the prediction entirely if this ever stops being true.
    requiresCodeExecution: true,
    // Shown in the panel under the meter.
    labelWillCompact:  'Auto-summarizes near the limit',
    labelHardWall:     'No auto-summarize — hard limit',
    noteWillCompact:
      'Code execution is on, so Claude should summarize earlier turns as this ' +
      'conversation approaches the window instead of stopping. Early detail gets ' +
      'lossy, so a handoff is still worth doing before quality drops.',
    noteHardWall:
      'Code execution is OFF, so automatic context management is unavailable: this ' +
      'conversation will hit a hard limit at the window rather than summarizing. ' +
      'Generate a handoff before you get there.',
    noteUnknown:
      'Conversation settings have not loaded yet, so whether this chat can ' +
      'auto-summarize is unknown.',
  },

  // ── FEEDBACK ─────────────────────────────────────────────────────────────
  // The in-panel feedback form POSTs to a RELAY you control, which forwards to
  // Discord. It deliberately does NOT hold a Discord webhook URL.
  //
  // WHY not post to Discord directly: a webhook URL shipped inside a browser
  // extension is public. Anyone who installs it can read it out of content.js and
  // post to the channel, and rotating it would require shipping a new release to
  // every user. Behind a relay the webhook stays server-side, can be rotated
  // freely, and can be rate-limited or filtered before anything reaches Discord.
  //
  // `endpoint` ships EMPTY. It is set in Options, which also requests host
  // permission for that origin at the moment it is saved — so the extension never
  // asks for broad network access it is not actually using.
  feedback: {
    enabled:  true,
    endpoint: '',
    maxLength: 2000,
    // Attached only when the user leaves the diagnostics box ticked, and rendered
    // verbatim in the panel first so the claim below is inspectable, not asserted.
    //
    // NEVER included, at any setting: message text, conversation title,
    // conversation id, project contents, or the page URL. Feedback is about the
    // METER, and none of that is needed to debug it.
    includeDiagnostics: true,
  },

  // ── UI ────────────────────────────────────────────────────────────────────
  thresholds: { warn: 0.70, danger: 0.85 },

  // ── RESPONSIVE / MOBILE (v0.5) ──────────────────────────────────────────────
  // Below `compactBreakpoint` (CSS px) — or on a coarse/touch pointer — the badge
  // collapses to an icon + percentage pill and the drill-down panel renders as a
  // full-width bottom sheet instead of a floating popover that would clip off the
  // edge of a phone screen. The same value is mirrored in badge.js's shadow CSS
  // `@media (max-width: …)` query; keep the two in sync if you change it.
  //
  // WHY 640: Pixel-class phones report ~360–412 CSS px; common phone landscape and
  // small tablets sit under 640. 640 is a conventional "small screen" cutoff that
  // also catches a narrowed desktop window (e.g. claude.ai in a side-by-side split).
  responsive: {
    compactBreakpoint: 640,
  },

  // ── HANDOFF (context-chaining) ──────────────────────────────────────────────
  // When the context fills past `thresholdPct`, offer to generate a "handoff
  // prompt" — a self-contained summary to paste into a fresh conversation.
  //
  // WHY 0.80: a handoff MUST be written while the model still sees the FULL,
  // uncompacted context, so it has to fire before auto-summarization starts.
  // Anthropic documents THAT summarization happens near the limit but publishes no
  // trigger percentage, so 0.80 is a headroom choice, not a measured threshold:
  // it leaves 200k of runway on a 1M window (100k at 500k, 40k at 200k) for the
  // handoff request's own input + output round-trip.
  //
  // When code execution is OFF there is no summarizer at all (see `compaction`
  // above) — the window is a hard wall, and this offer is the only thing standing
  // between the user and a dead conversation. content.js escalates the prompt
  // wording in that case.
  handoff: {
    enabled:      true,
    thresholdPct: 0.80,    // fire at 80% of the context window
    autoSend:     false,   // false = confirm-first (button); true = auto-send into composer
    // The request sent to Claude. {{FILES}} is replaced with the names of
    // attachments/artifacts we've tracked (so they can be re-attached).
    prompt:
      "We're approaching this conversation's context limit. Write a COMPLETE handoff prompt " +
      "I can paste into a brand-new conversation to continue this work with no loss of context. " +
      "Output it as ONE copy-pasteable block inside a code fence, containing:\n" +
      "1. Goal & current state — what we're building and exactly where we are now.\n" +
      "2. Key decisions & constraints made so far (and the reasoning).\n" +
      "3. Open tasks / next steps, in priority order.\n" +
      "4. Files & artifacts to re-attach by name (the new chat starts with none).\n" +
      "5. Gotchas / dead-ends to avoid repeating.\n" +
      "Be specific and self-contained — assume the new conversation has zero memory of this one.\n" +
      "{{FILES}}",
  },

  // ── HANDOFF DOC (VulcanAX session-handoff scaffold, v0.5) ────────────────────
  // Distinct from `handoff` above. `handoff` asks the in-chat model to WRITE a
  // continuation prompt. `handoffDoc` is assembled BY THE EXTENSION: it fills the
  // fields we can actually measure (tokens, %, source, model, counts, ids) and
  // leaves the semantic sections (decisions, next steps) as clearly-labeled EMPTY
  // slots — because the extension cannot know them without inventing continuity.
  // The operator pastes `chatSideAsk` into the chat, and drops Claude's reply into
  // the slots. Template is data so the VulcanAX convention can be tuned without
  // touching code. Placeholders ({{TOKEN}}) are substituted in content.js.
  handoffDoc: {
    // One-line instruction the operator pastes INTO the chat so the in-chat model
    // (which alone knows the semantic content) authors the Decisions + Next-steps
    // sections. The extension never fabricates these.
    chatSideAsk:
      "Summarize this session in VulcanAX session-handoff format. Output exactly two " +
      "markdown sections and nothing else:\n\n" +
      "## Decisions made\n" +
      "- key decisions taken this session, each with the reasoning, as bullets\n\n" +
      "## Next steps / open threads\n" +
      "- remaining work and unresolved questions, in priority order, as bullets\n\n" +
      "Be specific and self-contained — assume a fresh conversation with zero memory of this one.",

    // The scaffold. Auto-filled fields use {{PLACEHOLDER}} tokens; the two semantic sections are
    // intentionally empty with paste-instruction comments. Keep the working-dir line
    // as a placeholder the operator edits.
    template: [
      "# VulcanAX Session Handoff",
      "",
      "**Working dir:** `<!-- set me, e.g. C:\\Users\\you\\Projects\\vulcanax\\{{TITLE_SLUG}} -->`",
      "**Conversation:** {{TITLE}}",
      "**URL:** {{URL}}",
      "**Timestamp:** {{TIMESTAMP}}",
      "**Model:** {{MODEL}} · {{EFFORT}} effort",
      "",
      "## Context stats _(extension-measured estimates)_",
      "- **Total:** {{TOTAL}} / {{WINDOW}} tokens (**{{PCT}}** of window)",
      "- **Source:** `{{SOURCE}}` — {{SOURCE_DESC}}",
      "- **Turns (messages):** {{TURNS}}",
      "- **Attachments:** {{ATTACH_COUNT}} · **Artifacts:** {{ARTIFACT_COUNT}}",
      "- **Conversation id:** `{{CONV_ID}}`",
      "",
      "> These figures are measured/estimated by the Claude Context Meter extension. They are",
      "> authoritative server counts only when **Source** is `measured`; otherwise treat as estimates.",
      "",
      "## Decisions made",
      "<!-- paste from chat: ask Claude \"summarize decisions made this session in VulcanAX handoff format\" -->",
      "_(empty — fill from chat; see the \"Copy chat-side ask\" button in the meter panel)_",
      "",
      "## Next steps / open threads",
      "<!-- paste from chat: ask Claude \"list next steps and open threads in VulcanAX handoff format\" -->",
      "_(empty — fill from chat; see the \"Copy chat-side ask\" button in the meter panel)_",
      "",
      "## Continuation prompt",
      "_Paste this into a fresh conversation to continue (after filling the two sections above):_",
      "",
      "> Continuing a VulcanAX session. Working dir: `<set me to the same dir as above>`.",
      "> The **Decisions made** and **Next steps / open threads** sections below are carried over",
      "> from the prior conversation — pick up from the next steps in priority order, and re-attach",
      "> any files/artifacts named in the stats. Prior context summary:",
      ">",
      "> [paste the filled \"Decisions made\" + \"Next steps / open threads\" sections here]",
      "",
    ].join("\n"),
  },

  // Badge placement.
  //   'auto'        — smart: floats left-of-chat vertically centered on wide screens;
  //                   auto-collapses to the top-nav badge when a right-side panel opens
  //                   (artifact viewer, code preview) or the viewport narrows.
  //   'left-center' — always float left-of-chat vertically centered (no auto-collapse).
  //   'header'      — always inline in the top header bar (near the conversation title).
  //   'floating'    — always use the draggable floating widget (bottom-right).
  // 'nav' is accepted as a legacy alias for 'header'.
  placement: 'auto',

  // When placement is 'auto' and the badge auto-collapsed to the header because a
  // right-side panel opened, automatically re-expand to left-center when the panel
  // closes and width is restored. true = auto-return; false = stay in header until clicked.
  autoReExpand: true,

  // Minimum pixel gap between the badge's right edge and the chat column's left edge
  // when in left-center mode. If the gutter is narrower than this (sidebar too wide,
  // chat too wide for the viewport) the badge auto-collapses instead.
  leftCenterMinGutter: 180,

  // Default badge position for explicit floating mode (bottom-right).
  badgePosition: { right: 20, bottom: 80 },

  // NOTE: the old `calibration` block (a disabled toggle that would have called
  // api.anthropic.com/v1/messages/count_tokens to calibrate the estimate) is gone.
  // src/ctok reproduces count_tokens offline and exactly, so there is nothing left
  // to calibrate and no reason for this extension to hold an API key or reach any
  // host other than claude.ai.
};

export default CONFIG;
