/**
 * Minimal `chrome.*` shim so the built content script runs on a plain page.
 *
 * Only the five APIs content.js actually uses are implemented. Storage is
 * in-memory per page load, which is what we want: every run starts with no cached
 * tally, so the load path being exercised is the cold one.
 */
(function () {
  const store = {};
  window.chrome = {
    runtime: {
      // The extension resolves tokenizer data through this; the mock server maps
      // /ctok/* onto dist/ctok/*.
      getURL: (p) => `${location.origin}/${p.replace(/^\/+/, '')}`,
      id: 'e2e-mock',
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
          setTimeout(() => cb(out), 0);
        },
        set(obj, cb) {
          Object.assign(store, obj);
          if (cb) setTimeout(cb, 0);
        },
      },
      onChanged: { addListener() {} },
    },
  };
  // Stand in for the MV3 service worker's feedback relay so the payload the panel
  // actually builds is exercised, not a mock of it.
  window.chrome.runtime.sendMessage = (msg, cb) => {
    if (msg?.type !== 'feedback') { cb?.({}); return; }
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(msg.payload),
    })
      .then((r) => cb?.({ ok: r.ok, error: r.ok ? undefined : `HTTP ${r.status}` }))
      .catch((e) => cb?.({ ok: false, error: String(e) }));
  };
  window.chrome.runtime.getManifest = () => ({ version: '0.8.1' });
  window.chrome.permissions = {
    contains: (_o, cb) => cb ? cb(true) : Promise.resolve(true),
    request:  (_o, cb) => cb ? cb(true) : Promise.resolve(true),
  };

  // Surface what the extension is doing to the test driver.
  window.__ccmTrace = { messages: [], errors: [] };
  window.addEventListener('message', (e) => {
    if (e.data?.source === 'ccm-injected') {
      window.__ccmTrace.messages.push({ type: e.data.type, at: performance.now() });
    }
  });
  window.addEventListener('error', (e) => window.__ccmTrace.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection',
    (e) => window.__ccmTrace.errors.push('unhandled: ' + String(e.reason)));
})();
