import { type ReadableVfs, vjoin } from '@open-northland/vfs';
import { buildBackdropsIndexEntries } from './backdrops-index.js';
import { buildBobsIndexEntries } from './bobs-index.js';
import { buildMapsIndexEntries } from './maps-index.js';
import { resolveFileUnderRoot } from './under-root.js';

/**
 * The one table of app-facing `content/` routes, shared by every host that serves the pipeline's
 * output. Hosts pass the raw URL pathname; percent-decoding happens here.
 */

/** A file that already exists under the route's root. */
export interface ContentFileHit {
  readonly kind: 'file';
  readonly path: string;
  readonly contentType: string;
}

/** A payload built per request by scanning a subtree of `content/`. */
export interface ContentJsonHit {
  readonly kind: 'json';
  readonly body: () => Promise<unknown>;
}

export type ContentHit = ContentFileHit | ContentJsonHit;

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.atlas.json': 'application/json',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.cur': 'image/x-icon',
} as const;

type ServedExtension = keyof typeof CONTENT_TYPES;

// Shared by a file route and its index route, so the pair cannot drift onto different directories.
const MAPS_ROOT = 'maps';
const BOBS_ROOT = 'Data/engine2d/bin/bobs';
const BACKDROPS_ROOT = 'backdrops';

/** The one file served straight off the content root. */
const IR_PATHNAME = '/ir.json';

interface FileRoute {
  readonly prefix: string;
  /** Relative to the content dir. */
  readonly root: string;
  readonly extensions: readonly ServedExtension[];
}

// `/bobs` allows `.atlas.json` but not bare `.json`, so only atlas manifests are reachable there.
const FILE_ROUTES: readonly FileRoute[] = [
  { prefix: '/maps/', root: MAPS_ROOT, extensions: ['.json', '.png'] },
  { prefix: '/bobs/', root: BOBS_ROOT, extensions: ['.png', '.atlas.json'] },
  { prefix: '/textures/', root: 'Data/engine2d/bin/textures', extensions: ['.png'] },
  { prefix: '/sounds/', root: 'Data/engine2d/bin/sounds', extensions: ['.wav'] },
  // Rendered music: `.ogg` tracks (a `.wav` fallback when no encoder ran) + the track manifest.
  { prefix: '/music/', root: 'music', extensions: ['.ogg', '.wav', '.json'] },
  { prefix: '/gui/', root: 'gui', extensions: ['.json', '.png', '.cur'] },
  { prefix: '/gui-bitmaps/', root: 'Data/gui/bitmaps', extensions: ['.png'] },
  { prefix: '/goods/', root: 'goods', extensions: ['.json'] },
  { prefix: '/backdrops/', root: BACKDROPS_ROOT, extensions: ['.jpg'] },
];

interface IndexRoute {
  readonly pathname: string;
  readonly root: string;
  readonly build: (fs: ReadableVfs, root: string) => Promise<unknown>;
}

// An absent root is a miss rather than an empty list, so the app can tell "not converted" from "none".
const INDEX_ROUTES: readonly IndexRoute[] = [
  { pathname: '/maps-index', root: MAPS_ROOT, build: buildMapsIndexEntries },
  { pathname: '/bobs-index', root: BOBS_ROOT, build: buildBobsIndexEntries },
  { pathname: '/backdrops-index', root: BACKDROPS_ROOT, build: buildBackdropsIndexEntries },
];

/** One claimed pathname per route, so a host can prove it serves a static file at none of them. */
export const CONTENT_ROUTE_PROBES: readonly string[] = [
  IR_PATHNAME,
  ...INDEX_ROUTES.map((route) => route.pathname),
  ...FILE_ROUTES.map((route) => `${route.prefix}probe${route.extensions[0] ?? '.json'}`),
];

/** The longest allowed extension matching `file`, so `.atlas.json` wins over `.json`. */
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

/** The one table walk behind both exports, so claiming and resolving cannot use different routes. */
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
 * a catch-all page route must answer a real 404 for an in-namespace miss; falling through to
 * `index.html` as HTTP 200 would make a loader's `!res.ok` check read the missing file as bytes.
 */
export function isContentRoute(rawPathname: string): boolean {
  return matchRoute(rawPathname) !== undefined;
}

/** Resolve a request path (the raw URL pathname, query already stripped) against the content dir. */
export async function resolveContentRequest(
  fs: ReadableVfs,
  rawPathname: string,
  contentRoot: string,
): Promise<ContentHit | undefined> {
  const match = matchRoute(rawPathname);
  if (match === undefined) return undefined;
  switch (match.kind) {
    case 'ir': {
      const file = vjoin(contentRoot, 'ir.json');
      return (await fs.stat(file))?.kind === 'file'
        ? { kind: 'file', path: file, contentType: CONTENT_TYPES['.json'] }
        : undefined;
    }
    case 'index': {
      const root = vjoin(contentRoot, match.route.root);
      return (await fs.stat(root))?.kind === 'dir'
        ? { kind: 'json', body: () => match.route.build(fs, root) }
        : undefined;
    }
    case 'file': {
      const root = vjoin(contentRoot, match.route.root);
      const file = await resolveFileUnderRoot(fs, root, match.relative);
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
