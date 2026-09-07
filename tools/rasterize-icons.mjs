/**
 * Rasterize the SVG extension icons to PNG.
 *
 * WHY: the Chrome Web Store rejects SVG icons. They work fine when a folder is
 * loaded unpacked, which is why this went unnoticed — the requirement only bites
 * at submission time.
 *
 * Rasterizing happens in a real browser via canvas rather than through a native
 * image library, so the build keeps its two-dependency footprint (esbuild, and
 * Python only for regenerating tokenizer data). Serves a converter page, waits for
 * the browser driving it to POST the encoded PNGs back, and writes them.
 *
 * Usage:
 *   node tools/rasterize-icons.mjs            # starts the converter server
 *   node tools/rasterize-icons.mjs --check    # verify PNGs exist and are sane
 */

import http from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ICONS = path.join(ROOT, 'icons');
const SIZES = [16, 48, 128];
const PORT = 8751;

if (process.argv.includes('--check')) {
  const files = await readdir(ICONS);
  let bad = 0;
  for (const size of SIZES) {
    const name = `icon${size}.png`;
    if (!files.includes(name)) { console.log(`  MISSING ${name}`); bad++; continue; }
    const buf = await readFile(path.join(ICONS, name));
    // PNG signature + IHDR width/height, big-endian at offsets 16 and 20.
    const isPng = buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG';
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const ok = isPng && w === size && h === size;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}  ${w}x${h}  ${buf.length}b`);
  }
  process.exit(bad ? 1 : 0);
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>icon rasterizer</title>
<body style="background:#111;color:#eee;font-family:sans-serif;padding:16px">
<div id="log">working…</div>
<script>
const SIZES = ${JSON.stringify(SIZES)};
async function render(size) {
  const svg = await (await fetch('/icons/icon' + size + '.svg')).text();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);
  URL.revokeObjectURL(url);
  document.body.appendChild(c);
  return c.toDataURL('image/png').split(',')[1];
}
(async () => {
  const out = {};
  for (const s of SIZES) out[s] = await render(s);
  await fetch('/save', { method: 'POST', body: JSON.stringify(out) });
  document.getElementById('log').textContent = 'done';
  window.__rasterDone = true;
})().catch(e => { document.getElementById('log').textContent = 'ERROR ' + e; });
</script></body>`;

let resolveDone;
const done = new Promise((r) => { resolveDone = r; });

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const map = JSON.parse(body);
    for (const [size, b64] of Object.entries(map)) {
      const buf = Buffer.from(b64, 'base64');
      await writeFile(path.join(ICONS, `icon${size}.png`), buf);
      console.log(`  wrote icons/icon${size}.png  ${buf.length}b`);
    }
    res.writeHead(200); res.end('ok');
    resolveDone();
    return;
  }
  if (req.url.startsWith('/icons/')) {
    try {
      const buf = await readFile(path.join(ROOT, req.url.slice(1)));
      res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end(buf);
    } catch { res.writeHead(404); res.end(); }
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

server.listen(PORT, () => console.log(`rasterizer on http://localhost:${PORT}/`));
await done;
setTimeout(() => { server.close(); process.exit(0); }, 300);
