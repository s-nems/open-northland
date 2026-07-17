import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { buildBobsIndexEntries } from './bobs-index.js';
import { buildMapsIndexEntries } from './maps-index.js';

/**
 * The single table of app-facing `content/` routes, shared by every host that serves the pipeline's
 * output (the Vite dev middleware in `packages/app/vite.config.ts` and the desktop shell's `app://`
 * handler). Hosts pass the raw URL pathname — percent-decoding happens here — and get `undefined`
 * for anything unmatched, absent, or malformed, so a data dir without `content/` degrades to the
 * host's own 404 rather than crashing.
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

// The two subtrees a file route and a computed index route both address, named so the pair can
// never drift onto different directories.
const MAPS_ROOT = 'maps';
const BOBS_ROOT = 'Data/engine2d/bin/bobs';

/** One URL prefix → subtree-of-`content/` file route with its extension allowlist. */
interface FileRoute {
  readonly prefix: string;
  /** The route's root, relative to the content dir (native joins happen at resolve time). */
  readonly root: string;
  readonly extensions: readonly ServedExtension[];
}

// Routes mirror the pipeline's output layout. `/bobs` allows `.atlas.json` (not bare `.json`) so
// only atlas manifests are reachable there.
const FILE_ROUTES: readonly FileRoute[] = [
  { prefix: '/maps/', root: MAPS_ROOT, extensions: ['.json', '.png'] },
  { prefix: '/bobs/', root: BOBS_ROOT, extensions: ['.png', '.atlas.json'] },
  { prefix: '/textures/', root: 'Data/engine2d/bin/textures', extensions: ['.png'] },
  { prefix: '/sounds/', root: 'Data/engine2d/bin/sounds', extensions: ['.wav'] },
  { prefix: '/gui/', root: 'gui', extensions: ['.json', '.png', '.cur'] },
  { prefix: '/gui-bitmaps/', root: 'Data/gui/bitmaps', extensions: ['.png'] },
  { prefix: '/goods/', root: 'goods', extensions: ['.json'] },
];

/** One exact pathname → a JSON payload built by scanning a subtree of `content/`. */
interface IndexRoute {
  readonly pathname: string;
  readonly root: string;
  readonly build: (root: string) => unknown;
}

// An absent root is a miss rather than an empty list, so the app can tell "not converted" from "none".
const INDEX_ROUTES: readonly IndexRoute[] = [
  { pathname: '/maps-index', root: MAPS_ROOT, build: buildMapsIndexEntries },
  { pathname: '/bobs-index', root: BOBS_ROOT, build: buildBobsIndexEntries },
];

/** Longest matching served extension of `file`, or `undefined` when none is allowed on the route. */
function servedExtension(file: string, allowed: readonly ServedExtension[]): ServedExtension | undefined {
  let best: ServedExtension | undefined;
  for (const ext of allowed) {
    if (file.endsWith(ext) && (best === undefined || ext.length > best.length)) best = ext;
  }
  return best;
}

/** Resolve a request path (the raw URL pathname, query already stripped) against the content dir. */
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
  for (const route of INDEX_ROUTES) {
    if (pathname !== route.pathname) continue;
    const root = join(contentRoot, route.root);
    return existsSync(root) ? { kind: 'json', body: () => route.build(root) } : undefined;
  }
  for (const route of FILE_ROUTES) {
    if (!pathname.startsWith(route.prefix)) continue;
    const root = resolve(contentRoot, route.root);
    const rel = pathname.slice(route.prefix.length).replace(/^\/+/, '');
    // `resolve` already collapses `..`, so the containment check below sees the real target.
    const file = resolve(root, rel);
    const ext = servedExtension(file, route.extensions);
    if (!file.startsWith(root + sep) || ext === undefined || !existsSync(file)) return undefined;
    return { kind: 'file', path: file, contentType: CONTENT_TYPES[ext] };
  }
  return undefined;
}
