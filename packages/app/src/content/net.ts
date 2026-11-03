import { type AtlasSheetLayout, loadAtlasSource, type TextureSource } from '@open-northland/render';
import { diag } from '../diag/log.js';
import { ContentModLoadError } from './mods/merge.js';
import { contentModFile } from './mods/store.js';
import { CONTENT_PREFIX, type ContentFetch, contentFetch } from './url.js';

const modAssetUrls = new Map<string, string>();

/**
 * The fetch idioms this folder's optional-`content/` loaders share, kept in one place so the
 * degrade-gracefully policy cannot drift per file: content that is absent or unreadable resolves to
 * `null`/`undefined` instead of throwing, since a checkout without `content/` must still boot. Absence is
 * expected and is not diagnosed.
 */

/**
 * Fetch and parse a JSON document by its content path, or `null` when it is absent or unreadable.
 * `fetchImpl` is injectable so a headless caller can drive the same degrade policy over its own transport.
 */
export async function fetchJsonOrNull<T>(
  path: string,
  fetchImpl: ContentFetch = contentFetch,
): Promise<T | null> {
  try {
    const res = await fetchImpl(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof ContentModLoadError) throw error;
    return null;
  }
}

/**
 * Load a texture by its URL (a bundled asset's, or `contentUrl` of a content path) if the server has
 * it, else `undefined` so the caller degrades. Never rejects: `undefined` is the only failure signal
 * its callers read. Only a failed load pays for a HEAD probe, which tells expected absence (quiet)
 * from a broken file or transport (warned).
 */
export async function loadTextureIfPresent(
  url: string,
  scaleMode: 'nearest' | 'linear' = 'nearest',
): Promise<TextureSource | undefined> {
  try {
    return await loadAtlasWithMods(url, scaleMode);
  } catch (err) {
    if (!(await isServed(url))) return undefined;
    diag.warn('content', `net: optional texture ${url} failed to load; its caller falls back`, err);
    return undefined;
  }
}

/** Preserve the content MIME type when turning a modded file into a blob URL for the texture loader. */
export function modAssetBlobUrl(path: string, bytes: Uint8Array): string {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return URL.createObjectURL(new Blob([buffer], { type: contentType(path) }));
}

export async function moddedContentAssetUrl(url: string): Promise<string> {
  let pathname: string;
  try {
    pathname = new URL(url, location.href).pathname;
  } catch {
    return url;
  }
  if (CONTENT_PREFIX !== '' && !pathname.startsWith(`${CONTENT_PREFIX}/`)) return url;
  const path = CONTENT_PREFIX === '' ? pathname : pathname.slice(CONTENT_PREFIX.length);
  const cached = modAssetUrls.get(path);
  if (cached !== undefined) return cached;
  const bytes = await contentModFile(path);
  if (bytes === null) return url;
  const blobUrl = modAssetBlobUrl(path, bytes);
  modAssetUrls.set(path, blobUrl);
  return blobUrl;
}

export async function loadAtlasWithMods(
  url: string,
  scaleMode: 'nearest' | 'linear' = 'nearest',
  layout?: AtlasSheetLayout,
): Promise<TextureSource> {
  return loadAtlasSource(await moddedContentAssetUrl(url), scaleMode, layout);
}

/** False only when the server answers that `url` is absent; an unreachable server counts as served. */
async function isServed(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return true;
  }
}

/**
 * Fetch a content PNG by its content path and read it back CPU-side as pixels. `null` when the image
 * is absent or unreadable or no 2D context can be had, so callers degrade.
 */
export async function fetchImageData(path: string): Promise<ImageData | null> {
  try {
    const res = await contentFetch(path);
    if (!res.ok) return null;
    return await readImageData(await res.blob());
  } catch {
    return null;
  }
}

/** An image's pixels read back CPU-side through a 2D canvas (browser-only); rejects when the image
 *  cannot be decoded or no 2D context can be had. */
export async function readImageData(image: Blob, options?: ImageBitmapOptions): Promise<ImageData> {
  const bitmap = await createImageBitmap(image, options);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    // A CPU-backed canvas: the default GPU one makes every `getImageData` a synchronous GPU readback.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('no 2d context to read an image back');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
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
