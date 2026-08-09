import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveContentRequest, resolveFileUnderRoot } from '@open-northland/content-resolver';
import { nodeVfs } from '@open-northland/vfs/node';
import { net, protocol } from 'electron';
import { APP_ORIGIN_PREFIX, APP_SCHEME, GAME_HOST, routePathOf, SETUP_HOST } from './protocol-routing.js';

/** The `app://` scheme the shell serves the game from: the packaged stand-in for the Vite dev server. */

import type { Locale } from '@open-northland/installer/i18n';

export const GAME_URL = `${APP_ORIGIN_PREFIX}${GAME_HOST}/index.html`;
export const SETUP_URL = `${APP_ORIGIN_PREFIX}${SETUP_HOST}/setup.html`;

/** The game URL carrying the shell language in the `?lang=` seam the web app reads. */
export function gameUrlForLocale(locale: Locale): string {
  return `${GAME_URL}?lang=${locale}`;
}

const STATIC_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.wav': 'audio/wav',
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

/** A HEAD request gets headers only, serving the app's texture existence probes. */
async function serveFile(file: string, contentType: string, method: string): Promise<Response> {
  const headers = { 'content-type': contentType, ...CORS_HEADER };
  if (method === 'HEAD') return new Response(null, { headers });
  const res = await net.fetch(pathToFileURL(file).toString());
  return new Response(res.body, { headers });
}

const DIRECTORY_INDEX = 'index.html';

export interface AppProtocolRoots {
  /** The built web app (`packages/app/dist`). */
  readonly appRoot: string;
  /** The shell's own renderer files (the setup page). */
  readonly setupRoot: string;
  /** The data root's `content/` the shared routes serve from. */
  readonly contentRoot: string;
}

/** Install the `app://` handler; call once in `app.whenReady`. */
export function handleAppProtocol(roots: AppProtocolRoots): void {
  const fs = nodeVfs();
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);

    // The shared resolver takes the raw pathname (it owns percent-decoding).
    const routePath = routePathOf(url.host, url.pathname);
    if (routePath !== undefined) {
      const hit = await resolveContentRequest(fs, routePath, roots.contentRoot);
      if (hit !== undefined) {
        if (hit.kind === 'json') {
          return new Response(JSON.stringify(await hit.body()), {
            headers: { 'content-type': 'application/json', ...CORS_HEADER },
          });
        }
        return serveFile(hit.path, hit.contentType, request.method);
      }
    }

    // Static files exist only on the two real page hosts; a folded host that missed the routes is a 404.
    if (url.host !== GAME_HOST && url.host !== SETUP_HOST) return notFound();
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return notFound();
    }
    const root = url.host === SETUP_HOST ? roots.setupRoot : roots.appRoot;
    const file = await resolveFileUnderRoot(fs, root, pathname.replace(/^\/+/, '') || DIRECTORY_INDEX);
    if (file === undefined) return notFound();
    const contentType = STATIC_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return serveFile(file, contentType, request.method);
  });
}
