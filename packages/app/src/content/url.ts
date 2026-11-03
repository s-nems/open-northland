import { parseGeneratedContentSet } from '@open-northland/data';
import { ContentModLoadError, mergeContentModPatches } from './mods/merge.js';
import { contentModFile, contentModFiles } from './mods/store.js';

declare const __CONTENT_PREFIX__: string;

/**
 * The served prefix of generated content: `/c/<hash>` in a production build, whose hash covers the
 * bytes of the content tree it was built against, and empty at the dev server, in tests and in a
 * build without content, which serve the tree at bare paths. `build/content-hash.ts` owns the shape.
 */
export const CONTENT_PREFIX = typeof __CONTENT_PREFIX__ === 'string' ? __CONTENT_PREFIX__ : '';

/**
 * The URL the page loads a content path (`/bobs/x.webp`, `/ir.json`) from. Loaders and injected
 * fetches speak content paths; the URL is made only where a browser API takes it.
 */
export function contentUrl(path: string): string {
  return `${CONTENT_PREFIX}${path}`;
}

/** The content path of a sheet an atlas manifest names; stems with identical sheets share it. */
export function atlasImagePath(image: string): string {
  return `/bobs/${image}`;
}

let movedOn = false;
let movedOnListener: (() => void) | null = null;

/**
 * Runs `listener` once when a content fetch was redirected: the host no longer serves this page's
 * content hash and answered from another build's tree, so the page should reload before it mixes the
 * two. A redirect before registration runs it at registration.
 */
export function onContentMovedOn(listener: () => void): void {
  movedOnListener = listener;
  if (movedOn) listener();
}

/** A `fetch` over content paths only: a `URL` or `Request` would skip the content prefix. */
export type ContentFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** The page's `fetch` over content paths; an installed map's store answers the same paths itself. */
export const contentFetch: ContentFetch = async (path, init) => {
  if (path.replace(/^\/+/, '').toLowerCase() === 'ir.json') {
    const modFiles = await contentModFiles(path);
    if (modFiles.length > 0) {
      try {
        const response = await fetch(contentUrl(path), init);
        noteMovedOn(response);
        if (!response.ok && response.status !== 404) return response;
        const base = response.ok ? parseGeneratedContentSet(await response.json()) : null;
        const patches = modFiles.map(({ bytes }) => JSON.parse(new TextDecoder().decode(bytes)) as unknown);
        const merged = mergeContentModPatches(base, patches);
        return new Response(JSON.stringify(merged), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (error) {
        throw new ContentModLoadError(error instanceof Error ? error.message : String(error));
      }
    }
  }
  const modBytes = await contentModFile(path);
  if (modBytes !== null) {
    return new Response(new Uint8Array(modBytes), {
      headers: { 'content-type': contentType(path), 'content-length': String(modBytes.byteLength) },
    });
  }
  const response = await fetch(contentUrl(path), init);
  noteMovedOn(response);
  return response;
};

function noteMovedOn(response: Response): void {
  if (response.redirected && !movedOn) {
    movedOn = true;
    movedOnListener?.();
  }
}

function contentType(path: string): string {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.ogg')) return 'audio/ogg';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  return 'application/octet-stream';
}
