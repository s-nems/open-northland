import { extname } from 'node:path';
import { protocol } from 'electron';
import { fileResponse } from './file-response.js';
import type { ShellRoots } from './paths.js';
import { APP_ORIGIN_PREFIX, APP_SCHEME, GAME_HOST, routePathOf } from './protocol-routing.js';
import { servedFile } from './static-files.js';

/** The `app://` scheme the shell serves the game from: the packaged stand-in for the Vite dev server. */
export const GAME_URL = `${APP_ORIGIN_PREFIX}${GAME_HOST}/index.html`;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

/** Must run before `app.whenReady`: privileges make `app://` origin-ful so root-relative fetches work. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      // corsEnabled lets a fetch cross app:// hosts at all; CORS_HEADER below decides which may.
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

// A worker's fetch enforces CORS even on a custom scheme, and the folded host spellings (see
// `routePathOf`) are cross-origin to `app://game`. Only that origin may read across.
const CORS_HEADER = { 'access-control-allow-origin': 'app://game' } as const;

const DIRECTORY_INDEX = 'index.html';

/** Install the read-only app and generated-content handler once in `app.whenReady`. */
export function handleAppProtocol(roots: ShellRoots): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const routePath = routePathOf(url.host, url.pathname);
    const pathname = routePath === '/' ? `/${DIRECTORY_INDEX}` : routePath;
    const file = await servedFile(roots, pathname);
    if (file === undefined) return notFound();
    const contentType = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return fileResponse(file, request, { 'content-type': contentType, ...CORS_HEADER });
  });
}
