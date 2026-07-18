import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveContentRequest } from '@open-northland/content-routes';
import { net, protocol } from 'electron';
import { routePathOf } from './protocol-routing.js';

/**
 * The `app://` scheme the shell serves the game from — the packaged equivalent of the Vite dev
 * server: `app://game/<path>` maps to the built web app's static files plus the shared content
 * routes (`@open-northland/content-routes`) over the data root's `content/`, and `app://setup/…`
 * serves the first-run installer page from the shell's own renderer files.
 */

import type { Locale } from './i18n/index.js';

const APP_SCHEME = 'app';
/** Every page the shell serves sits under this prefix; the IPC and navigation guards gate on it. */
export const APP_ORIGIN_PREFIX = `${APP_SCHEME}://`;
export const GAME_URL = `${APP_ORIGIN_PREFIX}game/index.html`;
export const SETUP_URL = `${APP_ORIGIN_PREFIX}setup/setup.html`;

/**
 * The game URL carrying the installer's language into the web app via its `?lang=` seam (the game's
 * `localeParam` accepts `eng`/`pol`), so a language picked in the wizard also greets the player.
 */
export function gameUrlForLocale(locale: Locale): string {
  return `${GAME_URL}?lang=${locale}`;
}

/** Whether a loaded URL is the game page, tolerant of the `?lang=` query {@link gameUrlForLocale} adds. */
export function isGameUrl(url: string): boolean {
  return url === GAME_URL || url.startsWith(`${GAME_URL}?`);
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

// Pixi's mangled `app://bobs/...` spelling (see `routePathOf`) is cross-origin to `app://game`, and
// a worker's fetch enforces CORS even on a custom scheme. Only the game origin is approved — a page
// on any other origin (there should never be one) gets no cross-origin read.
const CORS_HEADER = { 'access-control-allow-origin': 'app://game' } as const;

/** Serve `file` with an explicit content type; a HEAD probe gets headers only (the app's texture probes). */
async function serveFile(file: string, contentType: string, method: string): Promise<Response> {
  const headers = { 'content-type': contentType, ...CORS_HEADER };
  if (method === 'HEAD') return new Response(null, { headers });
  const res = await net.fetch(pathToFileURL(file).toString());
  return new Response(res.body, { headers });
}

/** Resolve a static file under `root` with traversal rejected; `undefined` falls through to 404. */
function staticFileUnder(root: string, pathname: string): string | undefined {
  const rel = pathname.replace(/^\/+/, '');
  // `resolve` already collapses `..`, so the containment check below sees the real target.
  const file = resolve(root, rel === '' ? 'index.html' : rel);
  if (!file.startsWith(root + sep) || !existsSync(file)) return undefined;
  return file;
}

export interface AppProtocolRoots {
  /** The built web app (`packages/app/dist`) — packaged as a resource, the app dist in dev. */
  readonly appRoot: string;
  /** The shell's own renderer files (the setup page). */
  readonly setupRoot: string;
  /** The data root's `content/` dir the shared routes serve from. */
  readonly contentRoot: string;
}

/** Install the `app://` handler; call once in `app.whenReady`. */
export function handleAppProtocol(roots: AppProtocolRoots): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);

    // The shared resolver takes the raw pathname (it owns percent-decoding).
    const routePath = routePathOf(url.host, url.pathname);
    if (routePath !== undefined) {
      const hit = resolveContentRequest(routePath, roots.contentRoot);
      if (hit !== undefined) {
        if (hit.kind === 'json') {
          return new Response(JSON.stringify(hit.body()), {
            headers: { 'content-type': 'application/json', ...CORS_HEADER },
          });
        }
        return serveFile(hit.path, hit.contentType, request.method);
      }
    }

    // Static files exist only on the two real page hosts; a folded host that missed the routes is a 404.
    if (url.host !== 'game' && url.host !== 'setup') return notFound();
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return notFound();
    }
    const root = url.host === 'setup' ? roots.setupRoot : roots.appRoot;
    const file = staticFileUnder(root, pathname);
    if (file === undefined) return notFound();
    const contentType = STATIC_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return serveFile(file, contentType, request.method);
  });
}
