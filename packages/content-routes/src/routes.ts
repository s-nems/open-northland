import { existsSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { buildBobsIndexEntries } from './bobs-index.js';
import { buildMapsIndexEntries } from './maps-index.js';

/**
 * The single table of app-facing `content/` routes, shared by every host that serves the pipeline's
 * output to the app (the Vite dev middleware in `packages/app/vite.config.ts` and the desktop
 * shell's `app://` protocol handler). Semantics both hosts must honour: hosts pass the raw URL
 * pathname and percent-decoding happens here (a malformed sequence is a miss, never a throw), path
 * traversal is rejected (the resolved file must stay under the route's root), only the route's
 * listed extensions are served, and anything unmatched or absent resolves to `undefined` so the
 * host falls through to its own 404 — a checkout or data dir without `content/` must degrade,
 * never crash.
 */

/** A static file hit: stream `path` with `contentType`. */
export interface ContentFileHit {
  readonly kind: 'file';
  readonly path: string;
  readonly contentType: string;
}

/** A computed JSON hit (the `/maps-index` + `/bobs-index` payloads); `body()` builds it per request. */
export interface ContentJsonHit {
  readonly kind: 'json';
  readonly body: () => unknown;
}

export type ContentHit = ContentFileHit | ContentJsonHit;

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.atlas.json': 'application/json',
  '.wav': 'audio/wav',
  '.cur': 'image/x-icon',
} as const;

type ServedExtension = keyof typeof CONTENT_TYPES;

/** One URL prefix → subtree-of-`content/` file route with its extension allowlist. */
interface FileRoute {
  readonly prefix: string;
  /** The route's root, relative to the content dir (native joins happen at resolve time). */
  readonly root: string;
  readonly extensions: readonly ServedExtension[];
}

// Routes mirror the pipeline's output layout: decoded maps + menu sidecars, bob atlases, ground
// textures, sounds, the GUI strings/cursors, the GUI bitmap fills, and the goods manifest.
// `/bobs` allows `.atlas.json` (not bare `.json`) so only atlas manifests are reachable there.
const FILE_ROUTES: readonly FileRoute[] = [
  { prefix: '/maps/', root: 'maps', extensions: ['.json', '.png'] },
  { prefix: '/bobs/', root: 'Data/engine2d/bin/bobs', extensions: ['.png', '.atlas.json'] },
  { prefix: '/textures/', root: 'Data/engine2d/bin/textures', extensions: ['.png'] },
  { prefix: '/sounds/', root: 'Data/engine2d/bin/sounds', extensions: ['.wav'] },
  { prefix: '/gui/', root: 'gui', extensions: ['.json', '.png', '.cur'] },
  { prefix: '/gui-bitmaps/', root: 'Data/gui/bitmaps', extensions: ['.png'] },
  { prefix: '/goods/', root: 'goods', extensions: ['.json'] },
];

/** Longest matching served extension of `file`, or `undefined` when none is allowed on the route. */
function servedExtension(file: string, allowed: readonly ServedExtension[]): ServedExtension | undefined {
  let best: ServedExtension | undefined;
  for (const ext of allowed) {
    if (file.endsWith(ext) && (best === undefined || ext.length > best.length)) best = ext;
  }
  return best;
}

/**
 * Resolve a request path (the raw URL pathname, query already stripped) against the content dir.
 * Returns a file/JSON hit, or `undefined` for anything unmatched, malformed, traversal-escaping,
 * or absent.
 */
export function resolveContentRequest(rawPathname: string, contentRoot: string): ContentHit | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return undefined;
  }
  if (pathname === '/ir.json') {
    const file = join(contentRoot, 'ir.json');
    return existsSync(file) ? { kind: 'file', path: file, contentType: CONTENT_TYPES['.json'] } : undefined;
  }
  if (pathname === '/maps-index') {
    const mapsRoot = join(contentRoot, 'maps');
    return existsSync(mapsRoot) ? { kind: 'json', body: () => buildMapsIndexEntries(mapsRoot) } : undefined;
  }
  if (pathname === '/bobs-index') {
    const bobsRoot = join(contentRoot, 'Data/engine2d/bin/bobs');
    return existsSync(bobsRoot) ? { kind: 'json', body: () => buildBobsIndexEntries(bobsRoot) } : undefined;
  }
  for (const route of FILE_ROUTES) {
    if (!pathname.startsWith(route.prefix)) continue;
    const root = resolve(contentRoot, route.root);
    const rel = pathname.slice(route.prefix.length).replace(/^\/+/, '');
    const file = normalize(resolve(root, rel));
    const ext = servedExtension(file, route.extensions);
    if (!file.startsWith(root + sep) || ext === undefined || !existsSync(file)) return undefined;
    return { kind: 'file', path: file, contentType: CONTENT_TYPES[ext] };
  }
  return undefined;
}
