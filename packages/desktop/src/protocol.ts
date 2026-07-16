import { existsSync } from 'node:fs';
import { extname, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveContentRequest } from '@open-northland/content-routes';
import { net, protocol } from 'electron';

/**
 * The `app://` scheme the shell serves the game from — the packaged equivalent of the Vite dev
 * server: `app://game/<path>` maps to the built web app's static files plus the shared content
 * routes (`@open-northland/content-routes`) over the data root's `content/`, and `app://setup/…`
 * serves the first-run installer page from the shell's own renderer files.
 */

export const APP_SCHEME = 'app';
export const GAME_URL = 'app://game/index.html';
export const SETUP_URL = 'app://setup/setup.html';

const STATIC_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
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
      // corsEnabled lets a fetch cross app:// hosts at all (Pixi's mangled app://bobs spelling is
      // cross-origin to app://game); the CORS_HEADER below then approves it.
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

// Pixi's mangled `app://bobs/...` spelling (see the handler) is cross-origin to `app://game`, and a
// worker's fetch enforces CORS even on a custom scheme — every response must say allow-any-origin.
const CORS_HEADER = { 'access-control-allow-origin': '*' } as const;

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
  const file = normalize(resolve(root, rel === '' ? 'index.html' : rel));
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
    const pathname = decodeURIComponent(url.pathname);
    const root = url.host === 'setup' ? roots.setupRoot : roots.appRoot;

    // Pixi's path resolver mis-joins root-relative asset URLs on a custom scheme: a worker-side
    // `/bobs/<stem>.png` arrives as `app://bobs/<stem>.png` — the route segment lands in the HOST.
    // Fold such hosts back into the pathname so both spellings hit the same route table.
    const routePath = url.host === 'game' ? pathname : url.host === 'setup' ? undefined : `/${url.host}${pathname}`;
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

    const file = staticFileUnder(root, pathname);
    if (file === undefined) return notFound();
    const contentType = STATIC_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return serveFile(file, contentType, request.method);
  });
}
