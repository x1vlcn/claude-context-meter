# Claude Context Meter

**Docs → [x1vlcn.github.io/claude-context-meter](https://x1vlcn.github.io/claude-context-meter/)**  ·  [Latest release](https://github.com/x1vlcn/claude-context-meter/releases)

A Manifest V3 browser extension that overlays a live context-window meter on **claude.ai** — modeled after Claude Code's `/context` readout.

The badge sits in the **top-center of the app header** (next to the conversation title) and expands into a drill-down breakdown panel on click.

```
ⱯX Opus 5 · XHigh · 324k/1M (32%) ↺ ▾   ← compact badge (AX mark · model · effort · usage · refresh)
```

The badge wears the **VulcanAX Performance** skin (ember accent, restricted red, AX identity mark). The brand skin is applied **only to the meter's own UI** (its shadow DOM) — it never touches claude.ai's interface.

Click → expandable panel:

| Layer | Tokens |
|---|---|
| System prompt | 28.0k |
| &nbsp;&nbsp;Base system | 28.0k |
| Tools / features (available) | 10.7k |
| &nbsp;&nbsp;Web search | 10.7k |
| Messages | 103.0k |
| Attachments | 2.1k |
| Files & artifacts | 5.8k |
| Free space | 357.8k |
| **Context used** | **28%** |

---

## What's new in v0.8

### Exact token counts — Claude's own tokenizer, not an approximation of it

Counting no longer goes through OpenAI's `o200k_base` tokenizer scaled by a guessed
multiplier. `src/ctok/` is a JavaScript port of
[sanderland/ctok](https://github.com/sanderland/ctok) (MIT), which reconstructs
Claude's tokenizer and reproduces Anthropic's `count_tokens` **exactly**.

Verified document-for-document against upstream's recorded `count_tokens` values:

| Corpus | Documents | Exact |
|---|---|---|
| UDHR (501 natural languages) | 1,002 | 100% |
| Rosetta Code | 3,482 | 100% |
| Rosetta Code (held out) | 750 | 100% |
| MultiPL-E (22 programming languages) | 44 | 100% |
| **Total** | **5,278** | **100%** |

Run it yourself: `npm run test:tokenizer` (needs a clone of ctok next to this repo).

### How wrong was the old path?

Both methods scored against the same ground truth — Anthropic's recorded
`count_tokens` values. Neither method is the yardstick; the API is.

| Model family | v0.7 median error | v0.7 mean \|err\| | v0.7 within 5% | v0.8 |
|---|---|---|---|---|
| Opus 5 · Sonnet 5 | **−31.5%** | 32.7% | 0.0% | **100% exact** |
| Opus 4.8 · Opus 4.7 | **−10.6%** | 13.4% | 21.6% | **100% exact** |
| Sonnet 4.6 · Opus 4.6 · Haiku 4.5 | **−18.9%** | 20.1% | 0.8% | **100% exact** |

Every error ran the same direction — v0.7 **under**-counted, reporting more headroom
than existed. Worst on Opus 5, which had no multiplier entry at all and fell through
to `default: 1.0`. Combined with the 200k-instead-of-1M window bug, the badge read
roughly **3.4× too full** on that model.

The old path was measurably 24–144% off depending on model and content type. It is
gone, and with it the 2.7 MB of bundled OpenAI vocabulary:

| | v0.7 | v0.8 |
|---|---|---|
| `content.js` | 2.7 MB | **90 KB** |
| tokenizer data | bundled, always | fetched on demand, 210 KB (current models) |
| accuracy | approximation | exact |

Claude's tokenizer is not BPE-merge based — it behaves like minimum-piece
tokenization, so the count is the cheapest tiling of a marked stream over the
vocabulary. Word edges, capitalisation and byte fallback are written into that
stream as markers before tiling. Three families are supported: **v3** (Claude 3 →
4.6), **v4.7** (Opus 4.7/4.8) and **v5** (Opus 5, Sonnet 5 — same vocabulary as
v4.7, different message frame).

### Opus 5 / Sonnet 5 context windows — a 5× metering bug, fixed

Opus 5 and Sonnet 5 have a **1M** token window on paid plans when chatting. Neither
existed in the window table, so both fell through to the 200k default: the meter
read **five times too full** and offered a handoff at ~16% of the real window.

| Model | claude.ai chat window |
|---|---|
| Opus 5, Sonnet 5 | 1,000,000 |
| Opus 4.8 / 4.7 / 4.6, Sonnet 4.6 | 500,000 |
| Everything else (incl. Haiku 4.5) | 200,000 |

Source: [Anthropic — context window on paid plans](https://support.claude.com/en/articles/8606394-how-large-is-the-context-window-on-paid-claude-plans).
Note these are **chat** windows — the same model gets different limits in Claude
Code and Cowork. Fable 5 and Mythos 5 are deliberately absent: they are documented
for Code and Cowork but not for chat, so they render as "window unconfirmed"
rather than being metered against a guess.

### Will this conversation summarize, or stop dead?

Anthropic gates automatic context management on one setting:

> "Code execution must be enabled for automatic context management to work."
> — [Anthropic, usage and length limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)

That changes what the end of the window *means*:

- **Code execution ON** → Claude summarizes earlier turns and the conversation
  continues. Filling up is a quality event, not a stop.
- **Code execution OFF** → there is no summarizer. The conversation hits a **hard
  wall** and you must start a new chat.

The meter already reads that flag for its token cost, so the prediction is free —
no extra request, no extra permission. The panel now states which of the two you
are heading for, and the handoff offer escalates its wording in the hard-wall case.

### Effort: five tiers, and read from the right field

`xhigh` shipped with Opus 4.7 and sits between `high` and `max`, but the tier table
only had four entries — a turn sent at xhigh rendered as a raw string. Effort also
moved into `output_config.effort` and is no longer a top-level request field, so
the payload probe silently found nothing on every current model and fell back to
scraping the DOM. Both fixed. `thinking.budget_tokens` is now dead on every current
model (HTTP 400 on Opus 5 / Sonnet 5 / Opus 4.8 / 4.7 / Fable 5), so that fallback
is retained only for older conversations.

### Plan usage (session / weekly)

Context fill is not the only way a conversation stops — running out of plan
allowance is the other. The panel now shows session and weekly usage read from the
`/usage` endpoint, which returns unrounded figures where the claude.ai usage page
rounds, refined by the live `message_limit` fraction from the response stream.

That endpoint has no published schema, so an unrecognised response **hides the
section** rather than rendering a number that can't be stood behind.

---

## What's new in v0.6

### Model confirmed from the tree payload — the "?" is gone on any loaded chat

Previously the badge showed a tentative `?` (model unconfirmed) until a `POST /completion` happened to be intercepted. But the v0.4 **active tree fetch is deterministic and authoritative** — if we have a tree, we have the model. v0.6 reads the model directly from the tree payload and marks it **confirmed**:

- **Field path used:** the **latest assistant message node's model field** in the `tree=True` payload — probed as `chat_messages[].model`, then `.model_str` / `.model_id` / `.model_name` (last assistant wins → the model that actually answered). If no per-message model is present, it falls back to the **conversation-level** `model` (then `default_model` / `model_str`).
- `injected.js` reports which field supplied it in a `[ccm] tree model: <id> via <message.model | conversation>` debug line, so the real field can be confirmed on a live chat (toggle `DEBUG` in `injected.js`).
- The passive `/completion` intercept remains a secondary confirm. The `?` now appears **only** when both the tree lacks any model **and** no completion has been seen — effectively never on a loaded chat.

### Effort detected from the payload and mapped to Low / Medium / High / Max

Two bugs were stacked: effort was being **defaulted** (not detected), and the label scale was **stale** (`Standard` is not a current tier). Fixed:

- **Source (authoritative → fallback):** the `POST /completion` request body, then the visible composer effort selector in the DOM. The badge no longer defaults a tier — if effort is genuinely undetected, the segment is **omitted** rather than shown wrong.
- **Raw effort fields in the completion body:** an **enum string** — `effort` (also probed: `reasoning_effort`, `thinking_effort`) — and/or a **thinking budget** — `thinking.budget_tokens` when `thinking.type === "enabled"`. `injected.js` logs both (`[ccm] completion effort signals: { effortEnum, thinkingBudget }`) before any mapping.
- **Mapping (4-tier):** the enum maps directly for `low|medium|high|max` (with defensive aliases for legacy encodings like `standard → medium`, `extended → high`); when only a budget is present it maps through `config.effort.budgetThresholds`. If a raw value maps to **neither**, the badge shows the **raw value** instead of a wrong friendly label. All of this lives in `config.effort` (`enumMap`, `budgetThresholds`, `labels`).

> The budget thresholds and enum aliases are best-effort defaults pending confirmation against a live payload — the debug lines above print the exact `effortEnum` / `thinkingBudget` your account sends so the map can be tuned in `config.effort` if needed.

### VulcanAX brand skin (Performance mode) + AX mark

The badge and panel are restyled to VulcanAX **Performance / dark** canon — **applied to the meter's own shadow-DOM UI only**, never to claude.ai's interface (that is the separate, parked brand-skin extension).

- **Ember `#FF7A2D` is the primary accent** — healthy bar fill, active/hover states, the % text at healthy levels, the refresh icon, feature/handoff accents.
- **Red `#E8232A` is restricted** — the bar/percentage turn red **only** at the danger threshold, plus error/partial states. The bar progression is ember (healthy) → amber `#f59e0b` (warn) → red (danger).
- **AX mark** replaces the old status dot as the badge's identity glyph (compact pill `ⱯX 28% ↺ ▾` and panel header). Inline SVG in the shadow DOM, sourced from the VulcanAX brand asset `website/images/ax-mark.svg` (normalized to a square): the **"A" body is `currentColor`** (cream `#F5F5F7` on this dark surface) and the **"X" is red `#E8232A`** — the one sanctioned identity use of red. The threshold color lives on the percentage/bar, never on the mark.
- All palette values, the effort map, and thresholds live in the central `config.js` (`config.brand`, `config.effort`, `config.thresholds`). Optional **DM Sans** for numeric labels is available behind `config.brand.useDMSans` (off by default; loads via a Google Fonts `<link>`, no remote code — claude.ai's CSP may block it, in which case the system font remains).

---

## What's new in v0.5

### Responsive / mobile-usable UI (360px → desktop)

The badge and panel now reflow for small screens. Below **640 CSS px** (`config.responsive.compactBreakpoint`) the extension automatically:

- **Forces floating placement.** claude.ai's mobile header is cramped and differently shaped, so the header anchor is unreliable there — the badge drops to the floating layout automatically (it already does this whenever the header anchor can't be resolved on desktop too).
- **Collapses to an icon + percentage pill** — e.g. `● 28% ↺ ▾`. The full `model · effort · used/total` line moves into the **panel header** when you expand. The **refresh ↺** stays on the pill so you can force a recount on mobile without expanding (claude.ai's mobile web view virtualizes aggressively, so manual refresh matters).
- **Opens the drill-down as a bottom sheet** — full-width, anchored to the bottom of the viewport, internally scrollable (`max-height: 82vh`), with a ✕ close — instead of a floating popover that would clip off a phone screen. Verified at 375px with zero horizontal overflow.

On **coarse / touch pointers** (`@media (pointer: coarse)`) all controls — refresh, expand/collapse, reset, close, and the handoff buttons — get **≥44×44px** hit targets. Drag-to-reposition uses pointer events, so it works with touch; the position is persisted in `chrome.storage`.

The viewport is re-evaluated on resize/orientation change: crossing the breakpoint flips the badge between header and floating/bottom-sheet layouts live.

> **Mobile reality check (please read before trying to install on a phone).** The **Claude Android app is native and supports no extensions** — this extension cannot run there, full stop. The intended mobile target was Brave for Android. **However, as of 2026 Brave for Android does _not_ support loading _unpacked_ (local-folder) extensions** — its Android extension support (rolling out through 2026) is **Chrome Web Store–based**, and "Load unpacked" remains a **desktop-only** developer feature. So you can't side-load this `dist/` folder on Brave Android the way you do on desktop. See **[Install → Mobile](#mobile-android)** for the verified options. The build is byte-identical across desktop and mobile; only the _install channel_ differs.

### VulcanAX session-handoff doc generation

The expanded panel now has a **Session handoff** block with three actions:

- **Generate handoff** — assembles a VulcanAX-format markdown handoff doc and copies it to the clipboard (button flashes **Copied ✓**).
- **Download .md** — saves the same doc as `vulcanax-handoff-<title-slug>.md`.
- **Copy chat-side ask** — copies a one-line instruction you paste **into the chat** so the in-chat model authors the semantic sections.

**Scope boundary (this is deliberate — the extension does not fabricate continuity).** The extension fills only the fields it can actually **measure**, and leaves everything semantic as **empty, labeled slots**:

| Auto-filled (extension-measured) | Left as an empty slot (model-authored, in chat) |
|---|---|
| total tokens, % of window, source label (`measured`/`tree`/`cached`/`partial`) | **Decisions made** |
| model, effort, turn (message) count | **Next steps / open threads** |
| attachment & artifact counts, conversation id + URL, timestamp | |

The doc marks the stats block as **extension-measured estimates** (authoritative only when the source is `measured`). The two semantic sections carry a paste-instruction comment, and the **Copy chat-side ask** button hands you the exact prompt to drop into the conversation — so the decisions/next-steps are written by the model that actually has that context, never guessed by the extension. A pre-written **continuation prompt** (with the working-dir convention and a pointer to paste the filled sections) rounds out the doc. The whole template lives in `config.handoffDoc` so the VulcanAX convention can be tuned without touching code.

> This is distinct from the v0.3 **Handoff (context chaining)** feature below, which asks the in-chat model to _write_ a continuation prompt at ~80% fill. The v0.5 handoff **doc** is a structured scaffold assembled _by the extension_ (stats + slots), available any time from the panel.

---

## What's new in v0.4

### Deterministic tree capture (no more 156k vs 50k on the same chat)

**Root cause fixed:** v0.3 passively _intercepted_ claude.ai's one-time `GET /chat_conversations/{id}?tree=true` fetch. On fast loads and SPA back-navigation this request fired before the fetch hook was installed → the capture was missed → the meter silently fell back to the DOM (~50k). On a hook hit: full tree (~156k). Refreshing re-ran the race → nondeterministic numbers.

**v0.4 fix:** `injected.js` is now declared as a **`world: "MAIN"`, `run_at: "document_start"`** content script in `manifest.json`. It runs before React initialises, so the fetch wrapper is always installed before any API call fires. In addition, on every navigation and page load, `content.js` sends an explicit **active-tree-fetch** request to `injected.js`, which constructs and fetches the tree URL itself — deterministically, independent of the passive intercept. The passive intercept is kept as a secondary source.

### Source indicator — four trust levels

Every count now carries an explicit source tag visible in both the compact badge and the panel:

| Tag | Meaning | Trust |
|---|---|---|
| `measured` | SSE `usage.input_tokens` from the server — ground truth | Highest |
| `tree` | Tokenized from a fresh full conversation payload | High |
| `cached` | Stored tally from a previous visit, fresh fetch in progress | Medium |
| `partial` | DOM scan only — full tree not yet loaded; badge shows **`~`** prefix | Low |

Partial counts are never silently shown as authoritative: the compact badge shows `~142k` instead of `142k`, and the panel tooltip reads _"full conversation not yet loaded — click ↺ to recount."_

### Manual refresh button (↺)

Every state of the badge now shows a **↺** refresh control. Clicking it re-runs the active tree fetch and re-tokenizes the full conversation, forcing an authoritative recount on demand. The button spins (CSS animation) while the fetch is in flight, and the source tag updates to `tree` when it resolves.

### Per-conversation cache (v0.4 improvement)

On load the badge immediately shows the cached tally from the previous visit (tagged `cached`) while the active fetch runs in the background — no flash to zero, no wait for the full refetch before anything is displayed.

---

## What's new in v0.3

### Handoff (context chaining)

When the context fills past a threshold (**default 80%**), the badge offers to generate a **handoff prompt** — a self-contained summary you paste into a fresh conversation to continue the work without losing context.

- **Why 80%:** claude.ai silently auto-compacts (summarizes the earliest turns) around ~85%. The handoff must be written while the model still sees the **full, uncompacted** context — so it fires below that line, with ~25k headroom (at 500k) for the request round-trip. Configurable in Options.
- **Confirm-first (default):** at the threshold the badge shows **Generate handoff →**; one click sends the request. When Claude replies, a **Copy handoff** button copies its reply (largest code block) so you can paste it into a new chat.
- **Fully automatic (Options toggle):** auto-sends the request into the composer the moment the threshold is crossed. Off by default — auto-send drives the claude.ai composer via the DOM and can misfire if claude.ai changes it; confirm-first is safer.
- **Files:** the request lists the attachment/artifact names we've tracked (`{{FILES}}` in the prompt template) so you know what to re-attach — files can't be carried across conversations.
- **Graceful fallback:** if the composer can't be resolved, the request text is copied to your clipboard to paste & send manually. Fires once per conversation; dismissable.



- **Conversation tokens now come from the captured conversation payload, not the DOM.** The fetch hook already intercepts `GET /chat_conversations/{id}?tree=true`; v0.3 tokenizes the **full message tree** from that JSON. This counts **all** turns — including ones scrolled out / virtualized, collapsed tool results, and **closed artifact panels** — none of which are in the rendered DOM. (v0.2 tokenized `innerText`, so it under-reported any prior context not currently on screen.)
- **Attachments counted from `extracted_content`** — the actual in-context text of each attached file, instead of the old bytes÷4 guess from DOM size labels.
- **Artifacts counted from the payload** — artifact bodies are read from the `tool_use(name:"artifacts")` blocks in the message tree, so closed artifacts stop reading as 0 without opening the panel. Counted once (no double-count with conversation text).
- **"measured" vs "estimated" labeling.** When the streaming response exposes `usage.input_tokens` (ground-truth context size), the total is labeled **measured**; otherwise it's an **estimated** tokenization of the payload. See [Accuracy caveats](#accuracy-caveats).
- **Hybrid fallback** — brand-new chats and the brief window before the tree fetch resolves fall back to the DOM scan; the live streaming output delta is layered on top of whichever source is active. The last per-conversation tally is cached in `chrome.storage.local` to bridge the pre-fetch moment.
- **Project instructions** measured from the project endpoint when exposed (falls back to the manual `projectOverhead` setting). **Project Knowledge** is shown as a separate **"unmeasured"** line — it's RAG-retrieved, so only retrieved chunks enter context and they aren't visible in the payload. An optional manual estimate field is in Options.
- **Model name fixed** — renders `Opus 4.8` (not "Opus 4 8") via an explicit display-name map.
- **Effort always shown** — read from the DOM effort selector on load and on change, displayed in the badge (e.g. `Opus 4.8 · High · …`).
- **Placement moved to the header** — top-center near the conversation title, with a floating fallback. New `placement` setting: `auto` (header center → floating fallback) / `header` / `floating`.

## What's new in v0.2

- **Expandable drill-down panel** (click badge to open) — collapsible sections for baseline, tools, attachments, and artifacts
- **Nav-bar badge** — injected adjacent to the model selector; floating bottom-right fallback if nav anchor isn't found
- **Tool breakdown** — Available (definition loaded, adds to context) vs. Invoked (already counted in Messages, no double-count)
- **Per-item attachment list** — filename + size + token estimate for each attached file
- **Per-artifact list** — token size per artifact; closed artifact panels show cached sizes
- **Undercount indicator** — `⚠` on badge + note in panel when collapsed tool results, closed artifacts, or server compaction are detected
- **Project instructions overhead** — new Options field to add tokens for custom project system prompts
- **Placement setting** — `auto` / `nav` / `floating` in Options
- `postMessage` origin locked to `location.origin` instead of `"*"`
- Calibration UI disabled with "coming soon" label (no longer silently half-wired)

---

## Accuracy caveats

- **Where the numbers come from.** Conversation, attachment, and artifact tokens are tokenized from the captured `tree=true` conversation payload — so prior/virtualized/collapsed turns and closed artifacts **are** counted (this is the main v0.3 fix). When the streaming response exposes `usage.input_tokens`, the total is **measured** (ground truth); otherwise it's an **estimated** local tokenization.
- **System-prompt baseline is an estimate.** The ~28k baseline (system prompt + always-on tool definitions) is not in the payload and is approximated. Tunable in Options.
- **Project Knowledge is generally unmeasurable.** Project Knowledge docs are **RAG-retrieved** — only the chunks retrieved for a given turn enter context, and the payload doesn't expose which/how many. It's shown as a separate **"unmeasured"** line rather than silently folded into the total; set a manual estimate in Options if you want it included.
- **Images are estimated.** Image token cost depends on dimensions, which aren't in the payload. A flat per-image estimate (default 1,600) is applied and labeled approximate.
- **Pre-fetch / brand-new chats.** Before the active tree fetch resolves the meter shows either the cached tally from the previous visit (tagged `cached`) or a DOM-only estimate (tagged `partial`, `~` prefix). The full count settles once the tree payload arrives — typically within one second. Hit ↺ to force a recount at any time.
- **Tokenizer accuracy (v0.8).** Text is counted with a port of Claude's own tokenizer, which reproduces Anthropic's `count_tokens` exactly on all 5,278 upstream reference documents. Two caveats remain: (a) upstream validates **single user messages**, so per-message content is exact but the conversation's own framing overhead is not separately validated — which is why a `measured` reading from `usage.input_tokens` still outranks it; (b) for the few hundred milliseconds before a model's vocabulary finishes loading, and for any model released after this build, counting falls back to a measured chars-per-token ratio and the panel is tagged `approx`.
- **The system-prompt baseline is still the largest unknown.** Exact tokenization of the conversation does not make the total exact: the ~28k baseline is an estimate, images are estimated, and Project Knowledge is unmeasurable. The tokenizer fixed the part that *could* be fixed.

---

## Install (unpacked — Brave / Chrome / Edge)

**Windows:**
1. Open `brave://extensions` (or `chrome://extensions` / `edge://extensions`)
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select the `dist/` folder inside this repo

**macOS:**  Same steps; the extension is pure files with no OS-specific code.

**After changes:** click the **↺ reload** icon on the extension card. No need to reinstall.

> Brave/Chrome/Edge block out-of-store `.crx` installs. Always use **Load unpacked** with the unzipped `dist/` folder.

### Mobile (Android)

**Verified June 2026 — this is the honest state, not a fabricated flow.**

Two hard constraints shape what's possible on mobile:

1. **The Claude Android app is native and supports _no_ extensions.** This extension cannot run inside it. There is no workaround.
2. **Brave for Android does not support loading _unpacked_ extensions.** Brave's Android extension support (rolling out through 2026) installs extensions from the **Chrome Web Store**; there is **no `brave://extensions` "Load unpacked" / local-folder developer flow** on Android — that remains desktop-only. So the desktop "Load unpacked → select `dist/`" steps **do not have an Android equivalent.**

What you _can_ do, in order of practicality:

- **Test the responsive UI now, on desktop.** Open the same unpacked `dist/` build in desktop Brave/Chrome, then narrow the window below 640px (or use DevTools device toolbar / responsive mode). The compact pill and bottom-sheet panel engage at the breakpoint — this is exactly what renders on a phone. (Validated at 375px.)
- **Run it on a real phone via the Web Store, once published.** Because the build is identical desktop ↔ mobile, the same extension installed from the Chrome Web Store will run in Brave for Android wherever Brave's 2026 Web-Store extension support has reached your channel. This is the only supported path to a local-feeling install on Android, and it requires a store listing (not an unpacked folder).
- **Historically:** Kiwi Browser was the one Android browser that allowed unpacked (`chrome://extensions` → Load unpacked) extensions, but it is unmaintained and not recommended for an MV3 build in 2026.

If a future Brave Android channel adds a local/unpacked developer path, the steps would mirror desktop (same `dist/`); until then, treat **mobile = Web-Store-installed**, **desktop = unpacked**.

Sources: [brave/brave-browser#49525 — extensions on Android](https://github.com/brave/brave-browser/issues/49525), [brave/brave-browser#20296 — can't install non-Web-Store extensions](https://github.com/brave/brave-browser/issues/20296), [Brave Community — extensions on mobile](https://community.brave.app/t/brave-extensions-on-mobile/606419), [Privacy Guides — Brave to add Android extensions in 2026](https://discuss.privacyguides.net/t/brave-to-add-support-for-extensions-on-android-in-2026/36010).

---

## Build

```bash
npm install
npm run build   # → dist/   (load this folder)
npm run dev     # watch mode — rebuilds on save
```

Requires Node ≥ 18. esbuild bundles `gpt-tokenizer` (o200k_base) into `content.js`. No CDN, no remote code.

---


### Regenerating the tokenizer data

`src/ctok/data/*.json` is derived from [sanderland/ctok](https://github.com/sanderland/ctok)
and is committed, so a normal build needs nothing extra. To refresh it after an
upstream vocabulary update:

```bash
git clone https://github.com/sanderland/ctok ../ctok
npm run build:ctok-data      # regenerates vocab-v3 / vocab-v47 / unicode-tables
npm run test:tokenizer       # MUST still report 5,278/5,278 exact before shipping
```

The generator evaluates every per-codepoint predicate against the same
`unicodedata` ctok itself uses and ships the answers as range tables, so the
browser needs no Unicode knowledge of its own and cannot drift when its Unicode
version differs from the one that built the vocabulary.

## Tuning constants

Open the **Options page** (right-click the extension icon → Options) to tune values live without rebuilding. Key constants:

| Constant | Default | Source / WHY |
|---|---|---|
| `baselineTokens` | 28,000 | Mid-range of leaked claude.ai system prompts measured via Anthropic count_tokens API (Piebald-AI/claude-code-system-prompts, Jun 2026) |
| `projectOverhead` | 0 | Extra tokens for project-level custom instructions — set manually per project |
| `toolBaselines.webSearch` | 10,250 | lugia19/Claude-Usage-Extension `enabled_web_search` (empirically measured, Jun 2026) |
| `toolBaselines.codeExecution` | 5,300 | lugia19 `enabled_monkeys_in_a_barrel` (code execution codename) |
| `fallbackCharsPerToken['claude-opus-5']` | 2.6 | Measured with ctok over the upstream corpora (`tools/measure-fallback-ratio.mjs`): 3.485 chars/token on English prose, 2.049 on source code; shipped value is the geometric mean. **Fallback only** — the exact tokenizer is used whenever it is loaded. |
| `contextWindows['claude-opus-5']` | 1,000,000 | [Anthropic support](https://support.claude.com/en/articles/8606394-how-large-is-the-context-window-on-paid-claude-plans), verified Aug 2026 — chat surface |
| `contextWindows['claude-opus-4-8']` | 500,000 | Same source; the 4.x family is 500k on chat |
| `thresholds.warn` | 0.70 | Quality degrades noticeably above ~70–75% fill |
| `thresholds.danger` | 0.85 | Visual danger band. **Not** a compaction trigger — Anthropic documents *that* summarization happens near the limit but publishes no percentage, so no threshold here claims to be one. |

---

## How it works

### Architecture

```
manifest.json
├── injected.js  (MAIN world, document_start)  — wraps window.fetch before React; active+passive tree fetch
├── content.js   (isolated world, document_idle) — badge, tokenisation, header injection, DOM fallback, per-conv cache
├── service-worker.js                            — storage init only
└── options.html / options.js                   — settings UI
```

**injected.js** is loaded as a `world: "MAIN"` content script at `document_start` — it runs before React initialises, guaranteeing `window.fetch` is wrapped before any API call fires. A double-injection guard (`window.__ccm_injected__`) prevents re-execution if content.js also injects it as a `<script>` fallback for Chrome < 111.

**content.js** runs in the isolated content-script world. On boot and every SPA navigation it sends an **`active-tree-fetch`** message to injected.js, which constructs the tree URL from the captured org ID and fetches it deterministically. injected.js also passively intercepts claude.ai's own tree fetch as a secondary source, and re-fetches the tree after every turn completes (1.2 s debounce). All data flows back via `window.postMessage` (origin-locked to `https://claude.ai`).

Data captured by the fetch hook:
- **Effort signals** from `POST /completion` request bodies — the `effort` enum string (also `reasoning_effort` / `thinking_effort`) and/or `thinking.budget_tokens` — mapped to Low/Medium/High/Max in `config.effort` (this is the **authoritative** effort source; the DOM selector is the fallback)
- **Model** — confirmed from the **tree payload** (latest assistant message's model field, else conversation-level `model`); the `/completion` body `model` is a secondary confirm
- **Full message tree** from `GET /chat_conversations/{id}?tree=true` — message text, per-turn model, tool-use/result blocks, attachment `extracted_content`, artifact bodies, image references — relayed to content.js for tokenization (the tokenizer is bundled only in content.js, so injected.js extracts raw strings)
- Active feature flags from the same `tree=true` `settings` field
- Project custom instructions from `GET …/projects/{id}` (Project Knowledge docs are RAG-retrieved → counted as "unmeasured")
- `usage` (`input_tokens` / `output_tokens`) and `message_limit` from SSE events — `input_tokens` provides the **measured** context size; `output_tokens` is the live in-progress delta

### Token estimation pipeline

```
IF SSE usage.input_tokens seen → total = input_tokens + live output_tokens   [MEASURED]
ELSE estimate:
  baseline (28k + project instructions: measured or manual)
  + active tool overhead (webSearch, codeExecution, memory, …)
  + conversation text     ← tokenized from tree=true payload (all turns)   ╮
  + attachments           ← extracted_content from payload                  ├ ctok
  + artifacts             ← tool_use(name:"artifacts") bodies from payload ╯  (exact)
  + images                ← flat per-image estimate
  + project knowledge     ← manual estimate only (RAG = unmeasured)
  (fallback to DOM scan when the payload isn't captured yet;
   fallback to a measured chars/token ratio until the vocabulary loads)
──────────────────────────────────────────────────
= total  ÷ context window = %
```

### DOM selectors (MV3 resilience)

Only stable, non-hashed attributes — confirmed Jun 2026:
- `[data-testid="model-selector-dropdown"]` — model picker (compact badge text + header anchor)
- `[data-testid="conversation-title"]` / `[data-testid="chat-menu-trigger"]` / `header h1` — header/title anchor for badge placement
- effort selector — resilient candidate list + toolbar text scan, mapped to `Low` / `Medium` / `High` / `Max` (DOM is the fallback; the `/completion` body is the authoritative effort source)
- `[data-testid="human-turn"]` / `[data-testid="ai-turn"]` — conversation turns (DOM fallback only)
- `[role="banner"]`, `header` — header fallback candidates

A MutationObserver re-injects the badge into the header, re-detects the model, and re-reads the effort level on header re-renders and SPA navigation.

> Note: the conversation-title and effort-selector `data-testid`s above are the documented/expected anchors. Because the `tree=true` payload shape was validated against the documented structure (not a captured fixture from your account), confirm placement and the breakdown on a real long chat after install — selectors degrade gracefully (floating fallback / DOM fallback) if a future claude.ai revision renames them.

### Calibration status

**Resolved in v0.8 — and no longer needed.** The Options page used to carry a
disabled API-key field for calling `count_tokens` remotely to calibrate the
estimate. That is moot: `src/ctok/` reproduces `count_tokens` offline and exactly,
with no API key, no network call, and no data leaving the browser. The tokenizer
multiplier controls have been removed from Options along with it.

What still needs calibrating is everything the tokenizer does *not* cover — the
system-prompt baseline, per-feature tool overhead, image cost, and the
conversation's own framing. Those are the remaining sources of error.

---

## Prior art

- **[sanderland/ctok](https://github.com/sanderland/ctok)** (MIT) — the reconstructed
  Claude tokenizer. `src/ctok/` is a JavaScript port of it, and
  `tools/build-ctok-data.py` derives our vocabulary and Unicode tables directly from
  the upstream package. This is the single largest external contribution to the
  project's accuracy. Write-up:
  [On the biology of Claude's tokenizer](https://tokencontributions.substack.com/p/on-the-biology-of-claudes-tokenizer).
- [she-llac/claude-counter](https://github.com/she-llac/claude-counter) /
  [DP1110/Claude-token-counter-](https://github.com/DP1110/Claude-token-counter-) (MIT)
  — SSE interception pattern, and the `/usage` + `message_limit` quota sources this
  version adopts.
- [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension)
  (GPL-3.0) — per-tool baseline token measurements.
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
  (MIT) — system prompt token tables.
- [AI Toolbox context meter](https://www.ai-toolbox.co/ai-toolbox-claude-features/claude-context-window-meter-2026)
  (commercial) — the closest comparable product; its meter is DOM-scraped and its
  context-handoff feature is paywalled.

No code was copied from GPL-licensed sources. ctok is MIT and its port retains
upstream attribution in every file.

---

## Feedback

The panel has a **Send feedback** button. It POSTs to a relay URL you set in Options,
which is expected to forward to Discord or wherever else you want it.

**It deliberately cannot hold a Discord webhook.** A webhook URL shipped inside an
extension is readable by anyone who installs it, and rotating it would mean shipping a
new release to every user. Behind a relay you control, the webhook stays server-side
and can be rate-limited or filtered first.

The request body is:

```json
{
  "source": "claude-context-meter",
  "kind": "bug" | "idea" | "other",
  "message": "what the user typed",
  "diagnostics": { "version": "0.8.1", "model": "claude-opus-5", "window": 1000000,
                   "pct": 32.4, "tokenizer": "exact", "compaction": "will", "...": "..." }
}
```

`diagnostics` is `null` if the user unticks the box, and the panel renders the exact
object before sending it. It never carries conversation text, titles, ids, or the page
URL — none of that is needed to reproduce a metering bug.

Saving an endpoint requests browser permission for that origin at that moment; until
then the extension asks for no network access beyond claude.ai.

---

## Tests

```
npm test                # estimator wiring, model resolution, windows, compaction
npm run test:tokenizer  # 5,278-document exact-parity gate (needs ../ctok)
```

`tools/verify-ctok-parity.mjs` is the gate that matters: the tiling DP fails
*silently* — it returns a plausible number rather than an error — so nothing short
of document-for-document parity against recorded `count_tokens` values counts as
evidence that the tokenizer is correct.
