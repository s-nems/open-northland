// Serves the Knowledge window wireframe on 127.0.0.1. Design scaffolding: deleted with the design folder
// once the window is built.
// usage: node serve.mjs <port> <review-dir>
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const [port = '5186', review] = process.argv.slice(2);
if (review === undefined) throw new Error('usage: serve.mjs <port> <review-dir>');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
/** Served prefix to folder; `/app` gives the wireframe the game's own stylesheets and chrome art. */
const ROUTES = [
  ['/review/', review],
  ['/fonts/', join(repo, 'packages/app/public/fonts')],
  ['/app/', join(repo, 'packages/app/src')],
  ['/', here],
];

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname);
  const [prefix, folder] = ROUTES.find(([route]) => path.startsWith(route));
  const relative = normalize(path.slice(prefix.length) || 'index.html');
  const file = join(folder, relative);
  if (relative.startsWith('..') || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
}).listen(Number(port), '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}/`);
});
