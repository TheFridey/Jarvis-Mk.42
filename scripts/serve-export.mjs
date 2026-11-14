/**
 * Serve the built desktop export.
 *
 * The acceptance path uses the production export rather than `next dev`: it is what ships,
 * it needs no bundler at runtime, and it avoids the development server's Client Manifest
 * bug (`segment-explorer-node.js#SegmentViewNode`), which fails the page with a 500 in dev
 * mode while the same code builds and runs correctly.
 *
 * No dependencies. Loopback only.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// An acceptance run must never serve the owner's live export: JARVIS_EXPORT_DIR points at the
// isolated build, and the default stays exactly where the launcher expects it.
const root = process.env.JARVIS_EXPORT_DIR
  ? resolve(process.env.JARVIS_EXPORT_DIR)
  : resolve(fileURLToPath(new URL('../apps/desktop/out', import.meta.url)));
const port = Number(process.env.JARVIS_DESKTOP_PORT ?? 4300);
const host = '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No export at ${root}. Run: pnpm build:desktop (or scripts\\jarvis-up.ps1 -Build)`);
  process.exit(1);
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}`);
  const pathname = decodeURIComponent(url.pathname);
  let target = join(root, normalize(pathname).replace(/^([/\\])+/, ''));
  // Never serve outside the export directory, whatever the request says.
  if (!target.startsWith(root + sep) && target !== root) { response.writeHead(403).end('forbidden'); return; }
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
  if (!existsSync(target)) {
    // The export is a single page per route; fall back to its index for unknown paths.
    const fallback = join(root, 'index.html');
    if (!existsSync(fallback)) { response.writeHead(404).end('not found'); return; }
    response.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' });
    createReadStream(fallback).pipe(response);
    return;
  }
  response.writeHead(200, {
    'content-type': types[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': extname(target) === '.html' ? 'no-store' : 'public, max-age=3600',
  });
  createReadStream(target).pipe(response);
}).listen(port, host, () => console.log(`SENTIENCE export served at http://${host}:${port}/?mode=presence`));
