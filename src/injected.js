/**
 * Injected into the page's MAIN WORLD (not the isolated content script context)
 * so it can wrap the real window.fetch before any framework caches it.
 *
 * Communicates back to the content script via window.postMessage.
 * All output has source: 'ccm-injected' so the content script can filter it.
 *
 * MV3 CSP note: loaded via <script src="chrome-extension://..."> — no inline
 * scripts, no eval. Anthropic's own extension hit this CSP bug; we don't.
 *
 * ── v0.3 ──────────────────────────────────────────────────────────────────────
 * The tree=true handler now extracts the FULL conversation message tree (not just
 * `.settings`) so the content script can tokenize prior turns that are scrolled
 * out / virtualized / collapsed / in closed artifact panels — none of which are
 * in the DOM. The tokenizer (src/ctok, plus its lazily fetched vocabulary) lives
 * only in content.js, so here we extract the raw *text strings* and relay them;
 * content.js does the counting. Text is pre-concatenated per message to keep the
 * structured-clone cost of postMessage down.
 */
(function () {
  'use strict';

  // Guard against double-execution: manifest (world:MAIN, document_start) loads us
  // before React. content.js also injects a <script> tag as a fallback for Chrome <111.
  // The second arrival hits this guard and exits immediately.
  if (window.__ccm_injected__) return;
  window.__ccm_injected__ = true;

  const SOURCE = 'ccm-injected';
  // Use location.origin (https://claude.ai) instead of "*" — same-origin only.
  const ORIGIN = location.origin;

  function post(type, data) {
    window.postMessage({ source: SOURCE, type, data }, ORIGIN);
  }

  // ── SPA navigation detection ───────────────────────────────────────────────
  // claude.ai is a React SPA; pushState/replaceState signal page transitions.
  ['pushState', 'replaceState'].forEach((method) => {
    const orig = history[method].bind(history);
    history[method] = function (...args) {
      const result = orig(...args);
      post('navigation', { url: window.location.href, pathname: window.location.pathname });
      return result;
    };
  });

  window.addEventListener('popstate', () => {
    post('navigation', { url: window.location.href, pathname: window.location.pathname });
  });

  // ── Fetch interception ────────────────────────────────────────────────────
  const originalFetch = window.fetch.bind(window);

  const DEBUG = true; // [ccm] one-line console traces to diagnose hook matching

  // Remember the last tree URL so we can RE-fetch it after each completed turn
  // (claude.ai only fetches the tree on load, not when you send a new message).
  let lastTreeUrl = null;
  let refetchTimer = null;
  let refetching = false;

  // Org ID captured from the first intercepted /api/organizations/{uuid}/ request.
  // Used to construct the tree URL for the proactive (non-passive) fetch.
  let orgId = null;

  // If content.js requests an active fetch before we've seen the org ID,
  // queue it here and fire as soon as orgId arrives.
  let pendingActiveFetch = null;

  function scheduleTreeRefetch(delay = 1200) {
    if (!lastTreeUrl) return;
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(async () => {
      if (refetching) return;
      refetching = true;
      try {
        const resp = await originalFetch(lastTreeUrl, { credentials: 'include' });
        await postTreeFromResponse(resp, lastTreeUrl, 'refetch');
      } catch (e) {
        if (DEBUG) console.warn('[ccm] tree refetch failed:', e);
      } finally {
        refetching = false;
      }
    }, delay);
  }

  // Query string claude.ai itself uses for the tree. `rendering_mode=messages` is
  // LOAD-BEARING: without it the API returns only flat `chat_messages[].text` and
  // omits content[] entirely — every tool_use / tool_result / thinking block
  // disappears. Measured on a live 14-turn chat: 33.6k chars without it vs 330k
  // with it, a 6.5x undercount, because the active fetch overwrites the passive
  // intercept that DID see the full payload. Verified against claude.ai's own
  // request on 2026-09-07 — keep these in sync if the app changes them.
  const TREE_QS = '?tree=True&rendering_mode=messages&render_all_tools=true'
                + '&include_inline_comparison=true&consistency=strong';

  // ── Active (deterministic) tree fetch ─────────────────────────────────────
  // Unlike the passive intercept (which wins the race only sometimes), this
  // proactively fetches the tree using credentials that the page's own window.fetch
  // already has. orgId must be known; convId comes from the URL or from content.js.
  async function doActiveFetch(conversationId) {
    if (!orgId || !conversationId) return;
    const url = `${location.origin}/api/organizations/${orgId}/chat_conversations/${conversationId}${TREE_QS}`;
    lastTreeUrl = url; // prime for post-turn scheduleTreeRefetch too
    if (DEBUG) console.debug('[ccm] active tree fetch:', url);
    try {
      const resp = await originalFetch(url, { credentials: 'include' });
      if (!resp.ok) {
        if (DEBUG) console.warn('[ccm] active fetch HTTP', resp.status);
        post('tree-fetch-result', { conversationId, ok: false, status: resp.status });
        return;
      }
      await postTreeFromResponse(resp, url, 'active');
      // postTreeFromResponse posts 'conversation-data'; success is implicit.
    } catch (e) {
      if (DEBUG) console.warn('[ccm] active fetch error:', e);
      post('tree-fetch-result', { conversationId, ok: false, error: String(e?.message ?? e) });
    }
  }

  // -- Usage / quota ----------------------------------------------------------
  // claude.ai's own /usage page rounds its percentages. The endpoint behind it does
  // not, so reading it directly gives a finer figure than the UI shows. This is a
  // DIFFERENT axis from the context meter: context = how full THIS conversation is;
  // quota = how much of the session/weekly allowance is spent. Users hit both.
  //
  // SHAPE IS UNVERIFIED. This is an internal endpoint with no published schema, so
  // rather than hard-code a guess we probe several plausible shapes and, when none
  // match, relay the raw top-level keys as `unknownShape` so the panel stays silent
  // and the console can report what actually came back. Never invent a number.
  let usageFetchedAt = 0;
  // The last payload we posted. content.js may not have been listening when it
  // went out (it attaches at document_idle, we post at document_start), so a
  // replay is cheaper and more reliable than hoping the timing works out.
  let lastUsagePayload = null;
  async function doUsageFetch(force) {
    if (!orgId) return;
    // Replay first: whoever just asked may have missed the original post.
    if (lastUsagePayload) post('usage-quota', lastUsagePayload);
    // Polled at most once a minute: this is not per-turn data, and it runs against
    // the user's own session.
    const now = Date.now();
    if (!force && now - usageFetchedAt < 60000) return;
    usageFetchedAt = now;
    try {
      const resp = await originalFetch(
        location.origin + '/api/organizations/' + orgId + '/usage',
        { credentials: 'include', headers: { accept: 'application/json' } });
      if (!resp.ok) {
        if (DEBUG) console.debug('[ccm] usage fetch HTTP', resp.status);
        post('usage-quota', { ok: false, status: resp.status });
        return;
      }
      const data = await resp.json();
      lastUsagePayload = Object.assign({ ok: true }, normalizeUsage(data));
      post('usage-quota', lastUsagePayload);
    } catch (e) {
      if (DEBUG) console.debug('[ccm] usage fetch failed:', e);
      post('usage-quota', { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  // Pull {used, limit, fraction, resetsAt} out of whichever shape the endpoint uses.
  // Returns nulls (not zeros) when a field is absent, so the UI can distinguish
  // "no data" from "nothing used".
  function readWindow(node) {
    if (!node || typeof node !== 'object') return null;
    const used  = num(node.utilization) ?? num(node.used) ?? num(node.usage) ?? null;
    const limit = num(node.limit) ?? num(node.total) ?? num(node.cap) ?? null;
    const resetsAt = node.resets_at ?? node.resetsAt ?? node.reset_at ?? node.expires_at ?? null;
    // Two producers, two scales: the /usage endpoint reports `utilization` as a
    // 0..100 PERCENT (verified live 2026-09-07: five_hour.utilization === 33, with
    // no paired limit field), while the SSE message_limit reports a 0..1 fraction.
    // The old `used <= 1 ? used : null` collapsed every endpoint value to null, so
    // the quota bars silently rendered empty on real claude.ai.
    const fraction = (limit && used != null) ? (used / limit)
                   : used == null ? null
                   : used <= 1   ? used
                   : used / 100;
    if (used == null && fraction == null) return null;
    return { used, limit, fraction, resetsAt };
  }

  function normalizeUsage(data) {
    const d = data ?? {};
    const session = readWindow(d.five_hour ?? d.session ?? d.rate_limit ?? d.current_session);
    const weekly  = readWindow(d.seven_day ?? d.weekly ?? d.week ?? d.seven_day_all_models);
    const opus    = readWindow(d.seven_day_opus ?? d.weekly_opus ?? d.opus);
    if (!session && !weekly && !opus) {
      if (DEBUG) console.debug('[ccm] usage: unrecognized shape, top-level keys:', Object.keys(d));
      return { unknownShape: Object.keys(d).slice(0, 24) };
    }
    return { session: session, weekly: weekly, opus: opus };
  }

  async function postTreeFromResponse(response, url, why) {
    try {
      const data = await response.clone().json();
      const payload = extractConversation(data, url);
      if (DEBUG) console.debug(`[ccm] tree ${why}:`, payload.messageCount, 'msgs,',
        payload.conversationText?.length ?? 0, 'chars,',
        payload.attachments?.length ?? 0, 'attach,',
        payload.artifacts?.length ?? 0, 'artifacts');
      post('conversation-data', payload);
    } catch (e) {
      if (DEBUG) console.warn('[ccm] tree extraction failed:', e);
      post('conversation-data', { conversationId: extractConvId(url), settings: {}, error: String(e?.message ?? e) });
    }
  }

  // Messages from the isolated-world content script.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d?.source !== 'ccm-content') return;

    // Backstop debounced refetch (MutationObserver-driven).
    if (d.type === 'refetch-tree') {
      scheduleTreeRefetch(d.delay ?? 600);
      return;
    }

    // Quota refresh, requested on manual refresh and after a completed turn.
    if (d.type === 'usage-fetch') {
      doUsageFetch(!!d.force);
      return;
    }

    // Proactive fetch requested by content.js on load or manual refresh.
    if (d.type === 'active-tree-fetch') {
      const convId = d.conversationId;
      if (!convId) return;
      if (orgId) {
        doActiveFetch(convId);
      } else {
        // Org ID not yet seen — queue; doActiveFetch fires once we intercept it.
        pendingActiveFetch = convId;
        if (DEBUG) console.debug('[ccm] active fetch queued — waiting for orgId, convId:', convId);
      }
    }
  });

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    const lurl = url.toLowerCase();
    const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();

    // POST /completion — capture model + effort from the request body.
    // This is the AUTHORITATIVE effort source: the body carries exactly what the
    // turn was sent with. We relay the RAW signals (enum string and/or thinking
    // budget) and let content.js map them to a tier via config.effort, so the
    // 4-tier scale lives in one place and a raw value can be shown verbatim if it
    // doesn't map cleanly. (model is still confirmed primarily from the tree.)
    if (method === 'POST' && (url.includes('/completion') || url.includes('/retry_completion'))) {
      try {
        const body = init?.body;
        if (typeof body === 'string') {
          const parsed = JSON.parse(body);
          const model = parsed.model ?? null;
          // Effort enum. `output_config.effort` FIRST: effort moved inside
          // output_config and is no longer a top-level field, so probing only the
          // old paths silently found nothing on every current model and left the
          // meter falling back to a DOM scrape. The rest are older shapes.
          const effortEnum =
            (typeof parsed.output_config?.effort === 'string' && parsed.output_config.effort) ||
            (typeof parsed.outputConfig?.effort === 'string' && parsed.outputConfig.effort) ||
            (typeof parsed.effort === 'string' && parsed.effort) ||
            (typeof parsed.reasoning_effort === 'string' && parsed.reasoning_effort) ||
            (typeof parsed.thinking_effort === 'string' && parsed.thinking_effort) ||
            null;
          // Thinking budget - LEGACY. `thinking.budget_tokens` is removed from the
          // API (HTTP 400 on Opus 5 / Sonnet 5 / Opus 4.8 / 4.7 / Fable 5); current
          // turns send `thinking: {type: "adaptive"}`, which carries no budget.
          // Kept only so an older conversation still resolves.
          const thinkingBudget =
            parsed.thinking?.type === 'enabled'
              ? (num(parsed.thinking.budget_tokens) ?? null)
              : null;
          // Which field actually supplied the value - surfaced in DEBUG so a future
          // rename is diagnosable from the console instead of guessed at.
          const effortField =
            (typeof parsed.output_config?.effort === 'string') ? 'output_config.effort'
            : (typeof parsed.outputConfig?.effort === 'string') ? 'outputConfig.effort'
            : (typeof parsed.effort === 'string') ? 'effort'
            : (typeof parsed.reasoning_effort === 'string') ? 'reasoning_effort'
            : (typeof parsed.thinking_effort === 'string') ? 'thinking_effort'
            : null;
          if (DEBUG) console.debug('[ccm] completion effort signals:',
            { effortEnum, effortField, thinkingBudget, thinkingType: parsed.thinking?.type, model });
          post('request-capture', { model, effortEnum, effortField, thinkingBudget, url });
        }
      } catch (_) { /* non-JSON body — skip */ }
    }

    // Capture org ID from the first request that passes through our wrapper.
    // This primes doActiveFetch so it can construct the tree URL on demand.
    if (!orgId) {
      const om = url.match(/\/api\/organizations\/([^/?]+)\//);
      if (om) {
        orgId = om[1];
        if (DEBUG) console.debug('[ccm] orgId captured:', orgId);
        if (pendingActiveFetch) {
          const convId = pendingActiveFetch;
          pendingActiveFetch = null;
          doActiveFetch(convId);
        }
        doUsageFetch(true);
      }
    }

    // GET /chat_conversations/{id}?tree=True — capture feature flags AND the full
    // message tree so content.js can count prior/virtualized/collapsed/artifact tokens.
    // NOTE: claude.ai uses `tree=True` (capital T); match case-insensitively.
    // This passive intercept is the SECONDARY source; doActiveFetch is the primary.
    if (method === 'GET' && lurl.includes('/chat_conversations/') && lurl.includes('tree=true')) {
      lastTreeUrl = url; // remember for post-turn re-fetches
      const response = await originalFetch(input, init);
      postTreeFromResponse(response, url, 'captured'); // fire-and-forget (clones)
      return response;
    }

    // GET /projects/{uuid} — capture project custom instructions (counts toward context).
    // Excludes the /docs sub-resource (Project Knowledge is RAG-retrieved, not all in context).
    if (method === 'GET' && /\/projects\/[^/]+(?:\?|$)/.test(url) && !url.includes('/docs')) {
      const response = await originalFetch(input, init);
      response.clone().json().then((data) => {
        try {
          const proj = extractProject(data, url);
          if (proj) post('project-data', proj);
        } catch (_) {}
      }).catch(() => {});
      return response;
    }

    // SSE response — parse message_limit / usage events for rate-limit + live tokens.
    // After a /completion stream ENDS, re-fetch the tree so the new turn is counted.
    const response = await originalFetch(input, init);
    const isCompletion = method === 'POST' && (url.includes('/completion') || url.includes('/retry_completion'));
    if (isSSE(response)) {
      consumeSSE(response.clone(), isCompletion).catch(() => {});
    }
    return response;
  };

  function isSSE(response) {
    return (response.headers?.get('content-type') ?? '').includes('text/event-stream');
  }

  async function consumeSSE(response, isCompletion = false) {
    const reader = response.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(line.slice(6));
          if (json.type === 'message_limit') post('message-limit', json);
          if (json.type === 'message_delta' && json.usage) {
            post('usage-update', {
              outputTokens: json.usage.output_tokens ?? 0,
              inputTokens:  json.usage.input_tokens ?? null,  // ground-truth context size if present
            });
          }
          // message_start sometimes carries an initial usage with input_tokens.
          if (json.type === 'message_start' && json.message?.usage) {
            post('usage-update', {
              outputTokens: json.message.usage.output_tokens ?? 0,
              inputTokens:  json.message.usage.input_tokens ?? null,
            });
          }
        } catch (_) {}
      }
    }

    // Turn finished — re-fetch the tree so the new human+assistant messages are counted.
    if (isCompletion) {
      scheduleTreeRefetch();
      // A turn just consumed quota; refresh it (rate-limited inside doUsageFetch).
      doUsageFetch(true);
    }
  }

  function extractConvId(url) {
    const m = url.match(/chat_conversations\/([^/?]+)/);
    return m ? m[1] : null;
  }

  // ── Conversation tree extraction ───────────────────────────────────────────
  // Returns a normalized, tokenizer-friendly payload. We pre-join text per
  // message so content.js makes few large encode() calls instead of thousands.
  //
  // Defensive: every field is optional-chained with fallbacks because we are
  // building against the documented shape, not a captured fixture (see README).
  function extractConversation(data, url) {
    const settings   = data?.settings ?? {};
    const rawMessages = data?.chat_messages ?? data?.messages ?? [];
    // Conversation-level model (default for the chat). Candidate field names on
    // the conversation object, in priority order.
    const convModel  = data?.model ?? data?.default_model ?? data?.model_str ?? null;
    const projectId  = data?.project_uuid ?? data?.project?.uuid ?? null;

    const messages    = [];        // [{ role, text }] — per message, for the drill-down
    const attachments = [];        // { name, bytes, text }
    const artifactMap = new Map(); // id → { id, title, text }  (latest content wins)
    const images = [];             // { name, kind }

    let humanCount = 0;
    let assistantCount = 0;
    let measuredTokens = null;     // sum of per-message usage if (ever) present
    let sawUsage = false;

    // Per-turn model: the LATEST assistant message carries the model that actually
    // answered (authoritative for what's running now). claude.ai stores it on the
    // assistant message node — candidate field names probed in priority order.
    // This is the field path Fix-1 relies on; DEBUG logs which one hit so it can be
    // confirmed against a live chat.
    let latestAssistantModel = null;
    let modelFieldUsed = null;     // 'message.<field>' | 'conversation' — for DEBUG/report

    for (const msg of rawMessages) {
      const sender = msg?.sender ?? msg?.role ?? '';
      const role = (sender === 'assistant') ? 'assistant' : 'human';
      if (role === 'assistant') {
        assistantCount++;
        // Probe assistant-node model fields; last assistant wins → latest turn.
        const mField =
          (msg?.model      != null && 'model')      ||
          (msg?.model_str  != null && 'model_str')  ||
          (msg?.model_id   != null && 'model_id')   ||
          (msg?.model_name != null && 'model_name') || null;
        if (mField) { latestAssistantModel = msg[mField]; modelFieldUsed = `message.${mField}`; }
      } else humanCount++;

      // Probe for a ground-truth token field on the message (documented as absent;
      // we still look in case Anthropic exposes it later → label "measured").
      const u = msg?.usage ?? msg?.token_usage ?? null;
      const t = num(u?.input_tokens) ?? num(u?.tokens) ?? num(msg?.tokens) ?? num(msg?.token_count);
      if (t != null) { sawUsage = true; measuredTokens = (measuredTokens ?? 0) + t; }

      // ── content blocks (preferred) ── collected per-message so the panel can
      // show a per-message token breakdown. Artifact bodies are diverted out.
      const msgChunks = [];
      const blocks = Array.isArray(msg?.content) ? msg.content : null;
      if (blocks && blocks.length) {
        for (const block of blocks) walkBlock(block, msgChunks, artifactMap);
      } else if (typeof msg?.text === 'string' && msg.text) {
        msgChunks.push(msg.text); // legacy flat text fallback
      }
      const text = msgChunks.join('\n');
      if (text) messages.push({ role, text });

      // ── attachments (text files; extracted_content is the real in-context text) ──
      for (const a of asArray(msg?.attachments)) {
        const atext = typeof a?.extracted_content === 'string' ? a.extracted_content : null;
        const bytes = num(a?.file_size) ?? 0;
        if (atext || bytes) {
          attachments.push({
            name:  a?.file_name ?? 'Attachment',
            bytes,
            text:  atext,               // null → content.js falls back to bytes/4
          });
        }
      }

      // ── images / documents (files_v2 / files) ──
      for (const f of [...asArray(msg?.files_v2), ...asArray(msg?.files)]) {
        const kind = f?.file_kind ?? f?.file_type ?? 'image';
        images.push({ name: f?.file_name ?? 'image', kind });
      }
    }

    // The tree is authoritative — if we have it, we have the model. Prefer the
    // latest assistant turn's model; fall back to the conversation-level model.
    const model = latestAssistantModel ?? convModel;
    if (!modelFieldUsed && convModel) modelFieldUsed = 'conversation';
    if (DEBUG) console.debug('[ccm] tree model:', model, 'via', modelFieldUsed ?? '(none found)');

    return {
      conversationId: extractConvId(url),
      settings,
      model,
      // true whenever the model came from the tree payload (either source above).
      // content.js uses this to CONFIRM the model — the deterministic fetch means
      // a non-null model here is authoritative, not a guess.
      modelFromTree: model != null,
      modelField: modelFieldUsed,   // diagnostic: which field path supplied it
      projectId,
      messages,                                  // per-message [{role,text}]
      conversationText: messages.map(m => m.text).join('\n'),  // legacy/whole-string fallback
      messageCount: messages.length,
      humanCount,
      assistantCount,
      attachments,
      artifacts: [...artifactMap.values()],
      imageCount: images.length,
      images,
      measured: sawUsage,
      measuredTokens,
    };
  }

  // Walk a single content block. Artifact tool_use blocks are diverted into the
  // artifact map (counted once as a "Files & artifacts" line item) and NOT added
  // to conversationChunks, to avoid double-counting their body.
  function walkBlock(block, chunks, artifactMap) {
    const type = block?.type;
    if (!type) {
      // Some shapes nest plain strings or {text}
      if (typeof block === 'string') chunks.push(block);
      else if (typeof block?.text === 'string') chunks.push(block.text);
      return;
    }

    if (type === 'text') {
      if (typeof block.text === 'string') chunks.push(block.text);
      return;
    }

    if (type === 'thinking' || type === 'redacted_thinking') {
      // Historical extended-thinking is generally dropped from context on later
      // turns, so we do NOT recount it here (avoids large over-count). The
      // in-progress turn's thinking is captured via the streaming usage instead.
      return;
    }

    if (type === 'tool_use') {
      const name = (block.name ?? '').toLowerCase();
      if (name === 'artifacts' || name === 'artifact') {
        const input = block.input ?? {};
        const id    = input.id ?? block.id ?? `art_${artifactMap.size}`;
        const body  = typeof input.content === 'string' ? input.content
                    : typeof input.new_str === 'string' ? input.new_str
                    : '';
        const prev  = artifactMap.get(id);
        // create/rewrite → replace; update → append (latest cumulative content).
        const text  = (input.command === 'update' && prev) ? (prev.text + body) : body;
        artifactMap.set(id, {
          id,
          title: input.title ?? prev?.title ?? 'Artifact',
          text,
        });
        return;
      }
      // Non-artifact tool call: its name + serialized input occupy context.
      chunks.push(name);
      if (block.input != null) chunks.push(safeStringify(block.input));
      return;
    }

    if (type === 'tool_result') {
      const inner = block.content;
      if (typeof inner === 'string') chunks.push(inner);
      else for (const sub of asArray(inner)) {
        if (typeof sub?.text === 'string') chunks.push(sub.text);
        else if (typeof sub === 'string') chunks.push(sub);
      }
      return;
    }

    // Unknown block type: best-effort pull any .text, then recurse into .content.
    if (typeof block.text === 'string') chunks.push(block.text);
    for (const sub of asArray(block.content)) walkBlock(sub, chunks, artifactMap);
  }

  // ── Project custom-instruction extraction ──────────────────────────────────
  // Project Knowledge (docs) is RAG-retrieved and not all in context → handled as
  // "unmeasured" in content.js. Here we only capture the custom instruction text,
  // which IS injected into every turn's context.
  function extractProject(data, url) {
    const id = (url.match(/projects\/([^/?]+)/) ?? [])[1] ?? data?.uuid ?? null;
    const instructions =
      data?.prompt_template ??
      data?.custom_instructions ??
      data?.instructions ??
      (typeof data?.prompt === 'string' ? data.prompt : null) ??
      null;
    const docCount = Array.isArray(data?.docs) ? data.docs.length
                   : num(data?.docs_count) ?? null;
    if (instructions == null && docCount == null) return null;
    return { projectId: id, instructions, docCount };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  function asArray(v) { return Array.isArray(v) ? v : []; }
  function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
  function safeStringify(v) {
    try { return JSON.stringify(v); } catch (_) { return ''; }
  }
})();
