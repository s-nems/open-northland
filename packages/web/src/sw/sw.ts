import { resolveContentRequest } from '@open-northland/content-resolver';
import type { Vfs } from '@open-northland/vfs';
import { opfsVfs } from '@open-northland/vfs/opfs';
import { CONTENT_DIR } from '../opfs-layout.js';
import { contentRouteOf } from './route.js';

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

let opfs: Vfs | undefined;
async function contentFs(): Promise<Vfs> {
  opfs ??= opfsVfs(await navigator.storage.getDirectory());
  return opfs;
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

async function readContent(pathname: string, method: string): Promise<Response> {
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

/** Storage can fail between the resolver's stat and the read - another tab regenerating content is
 *  enough. A rejection here would reach the app as an opaque network error instead. */
async function serveContent(pathname: string, method: string): Promise<Response> {
  try {
    return await readContent(pathname, method);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`content unavailable: ${message}`, { status: 500 });
  }
}

sw.addEventListener('install', () => void sw.skipWaiting());
sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()));

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  const route = contentRouteOf(sw.location.pathname, new URL(request.url), sw.location.origin);
  if (route === undefined) return;
  event.respondWith(serveContent(route, request.method));
});
