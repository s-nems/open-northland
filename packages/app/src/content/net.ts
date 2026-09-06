import { loadAtlasSource, type TextureSource } from '@open-northland/render';
import { withBaseUrl } from '../base-url.js';
import { diag } from '../diag/log.js';

/**
 * The fetch idioms this folder's optional-`content/` loaders share, kept in one place so the
 * degrade-gracefully policy cannot drift per file: content that is absent or unreadable resolves to
 * `null`/`undefined` instead of throwing, since a checkout without `content/` must still boot. Absence is
 * expected and is not diagnosed.
 */

/**
 * Fetch and parse a JSON document, or `null` when it is absent or unreadable. `fetchImpl` is injectable
 * so a headless caller can drive the same degrade policy over its own transport.
 */
export async function fetchJsonOrNull<T>(url: string, fetchImpl: typeof fetch = fetch): Promise<T | null> {
  try {
    const res = await fetchImpl(withBaseUrl(url));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Load a texture if the server has it (HEAD probe), else `undefined` so the caller degrades. Never
 * rejects: `undefined` is the only failure signal its callers read.
 */
export async function loadTextureIfPresent(
  url: string,
  scaleMode: 'nearest' | 'linear' = 'nearest',
): Promise<TextureSource | undefined> {
  try {
    const resolvedUrl = withBaseUrl(url);
    const res = await fetch(resolvedUrl, { method: 'HEAD' });
    if (!res.ok) return undefined;
    return await loadAtlasSource(resolvedUrl, scaleMode);
  } catch (err) {
    diag.warn('content', `net: optional texture ${url} failed to load; its caller falls back`, err);
    return undefined;
  }
}

/**
 * Fetch a served PNG and read it back CPU-side as pixels via a 2D canvas (browser-only). `null` when the
 * image is absent or unreadable or no 2D context can be had, so callers degrade.
 */
export async function fetchImageData(url: string): Promise<ImageData | null> {
  try {
    const res = await fetch(withBaseUrl(url));
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return data;
  } catch {
    return null;
  }
}
