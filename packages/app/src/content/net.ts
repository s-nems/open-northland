import { loadAtlasSource, type TextureSource } from '@open-northland/render';

/**
 * The two fetch idioms every `content/` loader in this folder shares, kept in ONE place so the
 * degrade-gracefully policy can't drift per file:
 *
 *  - {@link fetchJsonOrNull} — optional JSON (a manifest, metrics, the IR): absent/unreadable → `null`,
 *    the caller falls back instead of crashing (a checkout without `content/` must still boot).
 *  - {@link loadTextureIfPresent} — optional texture (a palette/colour LUT): HEAD-probe first so a
 *    missing PNG degrades to `undefined` instead of a texture-load error.
 */

/** Fetch + parse a JSON document, or `null` when it is absent or unreadable. */
export async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Load a texture if the server has it (HEAD probe), else `undefined` so the caller degrades. */
export async function loadTextureIfPresent(url: string): Promise<TextureSource | undefined> {
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) return undefined;
  return loadAtlasSource(url);
}

/**
 * Fetch a served PNG and read it back CPU-side as pixels via a 2D canvas (browser-only). `null` when the
 * image is absent/unreadable or a 2D context can't be had, so callers degrade. The ONE home for the
 * fetch → `createImageBitmap` → canvas → `getImageData` readback, shared by the GUI bar-ramp LUT
 * (one row) and the minimap ground-page sampler (full buffer); each caller slices what it needs.
 */
export async function fetchImageData(url: string): Promise<ImageData | null> {
  try {
    const res = await fetch(url);
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
