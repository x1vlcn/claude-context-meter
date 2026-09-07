/**
 * Build script — bundles src/ into dist/ using esbuild.
 * Run: node build.js          (single build)
 *      node build.js --watch  (rebuild on change)
 *
 * Output layout (dist/ = folder to load unpacked in browser):
 *   dist/manifest.json
 *   dist/content.js       ← bundled (badge, estimator, ctok engine)
 *   dist/ctok/*.json      ← tokenizer vocabularies, fetched lazily at runtime
 *   dist/injected.js      ← bundled (standalone IIFE for main-world injection)
 *   dist/service-worker.js
 *   dist/options.html
 *   dist/options.js
 *   dist/options.css
 *   dist/icons/
 */

import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');
const DIST  = 'dist';

// Ensure dist/, dist/icons/ and dist/ctok/ exist
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'ctok'),  { recursive: true });

// ── JS bundles ────────────────────────────────────────────────────────────────
const sharedOpts = {
  bundle:   true,
  platform: 'browser',
  target:   'chrome120',
  format:   'iife',         // Self-contained — no module system needed in extension context
  minify:   !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

const bundles = [
  {
    entryPoints: ['src/content.js'],
    outfile:     `${DIST}/content.js`,
    // Badge, estimator and the ctok engine; the tokenizer VOCABULARY is not
    // bundled — see copyStatics() below.
  },
  {
    entryPoints: ['src/injected.js'],
    outfile:     `${DIST}/injected.js`,
    // Already an IIFE in source; esbuild wraps it again but that's harmless
    footer: {},
  },
  {
    entryPoints: ['src/service-worker.js'],
    outfile:     `${DIST}/service-worker.js`,
  },
  {
    entryPoints: ['src/options/options.js'],
    outfile:     `${DIST}/options.js`,
  },
];

// ── Static copies ─────────────────────────────────────────────────────────────
function copyStatics() {
  // manifest.json
  fs.copyFileSync('manifest.json', path.join(DIST, 'manifest.json'));

  // Options page HTML + CSS
  fs.copyFileSync('src/options/options.html', path.join(DIST, 'options.html'));
  fs.copyFileSync('src/options/options.css',  path.join(DIST, 'options.css'));

  // Icons. PNG only: the Chrome Web Store rejects SVG icons, and shipping the
  // unused SVG sources alongside them just invites review questions.
  for (const f of fs.readdirSync('icons')) {
    if (!f.endsWith('.png')) continue;
    fs.copyFileSync(path.join('icons', f), path.join(DIST, 'icons', f));
  }

  // ctok tokenizer data. Deliberately NOT bundled into content.js: the two
  // vocabularies are ~1.2 MB together and a session needs exactly one of them, so
  // they are fetched on demand via chrome.runtime.getURL (see content.js
  // configureLoader). Bundling would put both in every page load.
  const CTOK_SRC = path.join('src', 'ctok', 'data');
  if (fs.existsSync(CTOK_SRC)) {
    for (const f of fs.readdirSync(CTOK_SRC)) {
      if (!f.endsWith('.json')) continue;
      fs.copyFileSync(path.join(CTOK_SRC, f), path.join(DIST, 'ctok', f));
    }
  } else {
    console.warn('[ccm] WARNING: src/ctok/data missing — run tools/build-ctok-data.py');
  }

  console.log('[ccm] statics copied');
}

// ── Build ─────────────────────────────────────────────────────────────────────
if (watch) {
  // In watch mode, build each entry as a separate context so they rebuild independently.
  const contexts = await Promise.all(
    bundles.map((opts) => esbuild.context({ ...sharedOpts, ...opts })),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  copyStatics();
  console.log('[ccm] watching for changes… (Ctrl-C to stop)');
  // Watch static files with a simple poll — good enough for dev use.
  let prevMtime = {};
  setInterval(() => {
    const statics = [
      'manifest.json',
      'src/options/options.html',
      'src/options/options.css',
      ...fs.readdirSync('icons').map((f) => path.join('icons', f)),
      ...(fs.existsSync(path.join('src', 'ctok', 'data'))
          ? fs.readdirSync(path.join('src', 'ctok', 'data'))
              .map((f) => path.join('src', 'ctok', 'data', f))
          : []),
    ];
    let changed = false;
    for (const f of statics) {
      try {
        const mt = fs.statSync(f).mtimeMs;
        if (mt !== prevMtime[f]) { prevMtime[f] = mt; changed = true; }
      } catch (_) {}
    }
    if (changed) copyStatics();
  }, 500);
} else {
  await Promise.all(
    bundles.map((opts) => esbuild.build({ ...sharedOpts, ...opts })),
  );
  copyStatics();
  console.log('[ccm] build complete → dist/');
}
