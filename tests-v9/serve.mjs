// Tiny static server for the guide-v9 folder. Port is fixed (not 8777, 8765, 4173).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'guide-v9');
const PORT = Number(process.env.GUIDE_V9_PORT || 4391);
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || u.startsWith('/backend')) { res.writeHead(404); res.end('nope'); return; }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(b);
  });
}).listen(PORT, '127.0.0.1', () => console.log('guide-v9 static server on', PORT));
