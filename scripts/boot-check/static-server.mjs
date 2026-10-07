// The web image's document root without nginx: content files over the app build, as
// deploy/web/Dockerfile copies them, served from 127.0.0.1 on a free port.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};
const FALLBACK_CONTENT_TYPE = 'application/octet-stream';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;

/** The file a request path names under one of `roots`, the first root holding it winning; null when
 *  none does or the path escapes its root. */
async function resolveServedFile(roots, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  for (const root of roots) {
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) return null;
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return file;
  }
  return null;
}

/** Serves `roots` (earlier roots win) until `close()`; `origin` has no trailing slash. */
export async function startStaticServer(roots) {
  const absoluteRoots = roots.map((root) => resolve(root));
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(HTTP_METHOD_NOT_ALLOWED).end();
      return;
    }
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    const file = await resolveServedFile(absoluteRoots, pathname);
    if (file === null) {
      response.writeHead(HTTP_NOT_FOUND, { 'Content-Type': 'text/plain' }).end('not found\n');
      return;
    }
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? FALLBACK_CONTENT_TYPE;
    response.writeHead(HTTP_OK, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file)
      .on('error', () => response.destroy())
      .pipe(response);
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    // Port 0 asks the OS for a free port, which never collides with the dev servers' 5173-5199.
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('the static server reported no TCP port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
