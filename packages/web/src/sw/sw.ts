import { isContentRoute, resolveContentRequest } from '@open-northland/content-resolver';
import type { Vfs } from '@open-northland/vfs';
import { opfsVfs } from '@open-northland/vfs/opfs';
import { CONTENT_DIR } from '../opfs-layout.js';

/**
 * Serves the app's `content/` routes from the origin-private file system: the web analogue of the
 * desktop shell's `app://` protocol handler, so `packages/app` stays shell-agnostic. Static files
 * fall through to the network.
 */

/** The service-worker global, typed locally: this project compiles against the DOM lib. */
interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface SwGlobal {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
}

const sw = self as unknown as SwGlobal;

// sw.js sits at the site base (`<base>/sw.js`); the app lives under `<base>/play/`.
const playPrefix = `${sw.location.pathname.replace(/\/[^/]*$/, '')}/play`;

let opfs: Vfs | undefined;
async function contentFs(): Promise<Vfs> {
  opfs ??= opfsVfs(await navigator.storage.getDirectory());
  return opfs;
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

async function serveContent(pathname: string, method: string): Promise<Response> {
  const fs = await contentFs();
  const hit = await resolveContentRequest(fs, pathname, CONTENT_DIR);
  if (hit === undefined) return notFound();
  if (hit.kind === 'json') {
    return new Response(JSON.stringify(await hit.body()), {
      headers: { 'content-type': 'application/json' },
    });
  }
  const headers = { 'content-type': hit.contentType };
  if (method === 'HEAD') return new Response(null, { headers });
  const bytes = await fs.readFile(hit.path);
  // BodyInit rejects a possibly-SharedArrayBuffer-backed view; OPFS reads are plain ArrayBuffers.
  return new Response(bytes as unknown as BodyInit, { headers });
}

sw.addEventListener('install', () => void sw.skipWaiting());
sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()));

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin || !url.pathname.startsWith(`${playPrefix}/`)) return;
  const pathname = url.pathname.slice(playPrefix.length);
  if (!isContentRoute(pathname)) return;
  event.respondWith(serveContent(pathname, request.method));
});
