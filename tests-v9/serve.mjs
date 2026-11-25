// Tiny static server for the site root, as GitHub Pages serves it: at / and under /Welcome-To-Cascades-/ (the service worker scope).
// Only published files are served (an allow-list), never tests-v9, .git or node_modules. Port is fixed (not 8777, 8765, 4173).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.GUIDE_V9_PORT || 4391);
const PREFIX = '/Welcome-To-Cascades-';
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const ALLOW = /^\/(index\.html|sw\.js|icon-192\.png|favicon-32\.png|apple-touch-icon-180\.png|img\/[^/]+)$/;
const hits = [];

http.createServer((req, res) => {
  let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/__hits') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(hits)); return; }
  hits.push(req.method + ' ' + u);
  if (u === PREFIX || u.startsWith(PREFIX + '/')) u = u.slice(PREFIX.length) || '/';
  if (u === '/') u = '/index.html';
  const f = path.join(root, u);
  if (!ALLOW.test(u) || !f.startsWith(root)) { res.writeHead(404); res.end('nope'); return; }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store', ...(u === '/sw.js' ? { 'service-worker-allowed': PREFIX + '/' } : {}) });
    res.end(b);
  });
}).listen(PORT, '127.0.0.1', () => console.log('site-root static server on', PORT));
