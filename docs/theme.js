/* Theme controller — 2-way text toggle (Light / Dark).
   Default = follow OS (prefers-color-scheme). Explicit choice stored in
   localStorage and written to <html data-theme> before first paint.
   No explicit choice → data-theme="system" → CSS @media handles rendering. */
(function () {
  var KEY = 'vx-theme';
  var VALID = { light: 1, dark: 1 };

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return VALID[v] ? v : null;
    } catch (e) {
      return null;
    }
  }

  function apply(pref) {
    document.documentElement.setAttribute('data-theme', pref || 'system');
  }

  function resolvedTheme(pref) {
    if (pref) return pref;
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  /* 1. Pre-paint: apply synchronously. */
  apply(read());

  /* 2. Post-DOM: wire buttons + reflect state. */
  function wire() {
    var btns = document.querySelectorAll('.theme-toggle-btn[data-theme-set]');
    if (!btns.length) return;

    function reflect() {
      var resolved = resolvedTheme(read());
      btns.forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-theme-set') === resolved ? 'true' : 'false');
      });
    }

    reflect();

    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var pref = b.getAttribute('data-theme-set');
        if (!VALID[pref]) return;
        try { localStorage.setItem(KEY, pref); } catch (e) {}
        apply(pref);
        reflect();
      });
    });

    /* Update reflected state when OS preference changes (system mode only). */
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
        if (!read()) reflect();
      });
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
