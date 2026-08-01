import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildBobsIndexEntries } from './bobs-index.js';
import { buildMapsIndexEntries } from './maps-index.js';
import { resolveFileUnderRoot } from './under-root.js';

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

/** The one whole-file top-level route: the generated IR document. */
const IR_PATHNAME = '/ir.json';

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

/** Which route a pathname claims, before anything on disk is consulted. */
type RouteMatch =
  | { readonly kind: 'ir' }
  | { readonly kind: 'index'; readonly route: IndexRoute }
  | { readonly kind: 'file'; readonly route: FileRoute; readonly relative: string };

/**
 * The single table walk behind both exports, so "this pathname is ours" and "this pathname resolves"
 * can never answer from different route sets.
 */
function matchRoute(rawPathname: string): RouteMatch | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return undefined;
  }
  if (pathname === IR_PATHNAME) return { kind: 'ir' };
  const index = INDEX_ROUTES.find((route) => pathname === route.pathname);
  if (index !== undefined) return { kind: 'index', route: index };
  const file = FILE_ROUTES.find((route) => pathname.startsWith(route.prefix));
  if (file === undefined) return undefined;
  return { kind: 'file', route: file, relative: pathname.slice(file.prefix.length) };
}

/**
 * Whether a pathname belongs to the content namespace, even when nothing resolves there. A host with
 * its own catch-all page route (Vite's SPA fallback) must answer a real 404 for an in-namespace miss:
 * falling through would serve `index.html` as HTTP 200 `text/html`, and every content loader's
 * absence check (`!res.ok`) would mis-read the missing file as bytes.
 */
export function isContentRoute(rawPathname: string): boolean {
  return matchRoute(rawPathname) !== undefined;
}

/** Resolve a request path (the raw URL pathname, query already stripped) against the content dir. */
export function resolveContentRequest(rawPathname: string, contentRoot: string): ContentHit | undefined {
  const match = matchRoute(rawPathname);
  if (match === undefined) return undefined;
  switch (match.kind) {
    case 'ir': {
      const file = join(contentRoot, 'ir.json');
      return existsSync(file) ? { kind: 'file', path: file, contentType: CONTENT_TYPES['.json'] } : undefined;
    }
    case 'index': {
      const root = join(contentRoot, match.route.root);
      return existsSync(root) ? { kind: 'json', body: () => match.route.build(root) } : undefined;
    }
    case 'file': {
      const root = resolve(contentRoot, match.route.root);
      const file = resolveFileUnderRoot(root, match.relative);
      if (file === undefined) return undefined;
      const ext = servedExtension(file, match.route.extensions);
      return ext === undefined ? undefined : { kind: 'file', path: file, contentType: CONTENT_TYPES[ext] };
    }
    default: {
      const exhaustive: never = match;
      throw new Error(`unhandled route match ${JSON.stringify(exhaustive)}`);
    }
  }
}
