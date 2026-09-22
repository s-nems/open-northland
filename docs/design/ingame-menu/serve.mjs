// Local mockup server: repository files first, then the local-only review directories (never committed).
// Usage: node docs/design/ingame-menu/serve.mjs [port] [review-dir...]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_DIR = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 5187);
const localDirs = process.argv.slice(3);
const roots = [REPO_DIR, ...localDirs];
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/plain; charset=utf-8',
};

function locate(pathname) {
  const relative = pathname === '/' ? '/foundation.html' : pathname;
  for (const root of roots) {
    const file = normalize(join(root, relative));
    if (!file.startsWith(root + sep)) continue;
    try {
      const stat = statSync(file);
      if (stat.isFile()) return { file, size: stat.size };
    } catch {
      // Try the next root.
    }
  }
  return undefined;
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const found = locate(decodeURIComponent(pathname));
  if (!found) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);
    return;
  }
  response.writeHead(200, {
    'content-type': types[extname(found.file)] ?? 'application/octet-stream',
    'content-length': found.size,
    'cache-control': 'no-cache',
  });
  createReadStream(found.file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(
    `http://127.0.0.1:${port}/  repo: ${REPO_DIR}  local review inputs: ${localDirs.join(', ') || 'none'}`,
  );
});
