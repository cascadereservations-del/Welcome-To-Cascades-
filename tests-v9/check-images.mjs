// Static image check for the site root: every literal img/ path in index.html (HTML, CSS url(), JS strings) must be a file,
// and every file name used by the JS tables (img/${x}.webp) is found by matching quoted names against the img/ folder.
// The runtime counterpart (every chapter and sheet opened, every resolved URL fetched) is test C1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = new Set(fs.readdirSync(path.join(root, 'img')).filter((f) => fs.statSync(path.join(root, 'img', f)).isFile()));
const literal = new Set([...html.matchAll(/img\/([A-Za-z0-9_\-.]+\.(?:webp|png|jpe?g|svg|gif))/g)].map((m) => m[1]));
const stems = new Set([...files].map((f) => f.replace(/\.[^.]+$/, '')));
const tableUses = new Set([...html.matchAll(/['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]/g)].map((m) => m[1]).filter((s) => stems.has(s)));
const missing = [...literal].filter((f) => !files.has(f));
// names in the JS tables that look like picture names (contain a known stem prefix) but are not files
const suspect = [...html.matchAll(/\[\s*['"]([a-z0-9]+(?:-[a-z0-9]+)+)['"]\s*,/g)].map((m) => m[1]).filter((s) => !stems.has(s) && /^(d|ranchero|sevenmonkeys|shaperz|soluna|valleyhigh|mimis|euphoria|highstreet|kcc|gusteaus|brigada|edsai)-/.test(s));
console.log(`literal img/ references: ${literal.size}; names from JS tables matching a file: ${tableUses.size}; files in img/: ${files.size}`);
console.log(`missing literal references: ${missing.length}${missing.length ? ' ' + missing.join(', ') : ''}`);
console.log(`table names that look like pictures but are not files: ${suspect.length}${suspect.length ? ' ' + suspect.join(', ') : ''}`);
process.exit(missing.length || suspect.length ? 1 : 0);
