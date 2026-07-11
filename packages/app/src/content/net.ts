import { loadAtlasSource, type TextureSource } from '@vinland/render';

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
