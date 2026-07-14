import type { TextureSource } from 'pixi.js';
import { type DrawableResource, isDrawableResource } from '../drawable-resource.js';

/**
 * Per-atlas alpha masks for pixel-accurate sprite hit-testing — "click the graphic, not the box".
 *
 * The picker's first pass is the sprite's AABB ({@link import('./pooled-entity.js').EntityBounds}); a
 * large building's box swallows a lot of transparent corner, so a click *next to* the house still
 * selected it. This module supplies the refinement: a 1-bit solid/transparent mask per atlas sheet,
 * built lazily from the decoded atlas pixels and sampled at the clicked texel.
 *
 * Source basis: this is a deliberate deviation from the original engine, which resolves a world click
 * to a half-cell and asks the logic layer which house occupies it (OpenVikings
 * `CWorldDisplayElement.l_UpdateCursorPosition` → `DED_WorldPixelToMapMIGCoordinates` → cell→house
 * lookup — footprint-based, so a tall tower's roof was not clickable there). Per the user's direction,
 * OpenNorthland instead hit-tests the drawn sprite itself: anywhere on the graphic selects, anywhere off it
 * does not.
 */

/**
 * Minimum alpha (0..255) a texel needs to count as clickable. Bob art is mostly hard-edged, but
 * decoded `Double8Bit` bobs carry soft per-pixel alpha (anti-aliased rims, baked shadow skirts);
 * half-opacity keeps the anti-aliased body edge clickable while dropping shadows and glow, which read
 * as "next to the building", not on it. An approximation — the original never alpha-picks at all.
 */
export const SOLID_ALPHA_MIN = 128;

/** A 1-bit solid/transparent mask over a whole atlas sheet (row-major, bit-packed — ~2 MB for 4096²). */
export interface AlphaMask {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;
}

/** Pack RGBA pixel data into an {@link AlphaMask}: bit set ⇔ `alpha >= SOLID_ALPHA_MIN`. */
export function buildAlphaMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): AlphaMask {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (let i = 0; i < width * height; i++) {
    const alpha = rgba[i * 4 + 3] ?? 0;
    if (alpha >= SOLID_ALPHA_MIN) {
      bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7));
    }
  }
  return { width, height, bits };
}

/** Whether the mask's texel `(x, y)` is solid. Out-of-range coordinates are transparent. */
export function maskSolidAt(mask: AlphaMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const i = y * mask.width + x;
  return ((mask.bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
}

/** Lazily-built masks per atlas sheet. WeakMap: a dropped TextureSource releases its mask with it.
 *  `null` is cached too — an unreadable source (no 2d context, non-drawable resource) is not retried
 *  on every click. */
const maskCache = new WeakMap<TextureSource, AlphaMask | null>();

/** Read the RGBA pixels of a drawable via a throwaway 2d canvas, or `null` when unavailable
 *  (headless test env without canvas, or a context the platform refuses). */
function readPixels(resource: DrawableResource, width: number, height: number): ImageData | null {
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : (() => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            return c;
          })();
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (ctx === null) return null;
    ctx.drawImage(resource, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null; // tainted/undecodable source — the caller falls back to the box hit
  }
}

/**
 * The alpha mask of an atlas sheet, built once on first use from the texture's CPU-side image
 * (`TextureSource.resource` — the very ImageBitmap Pixi uploaded), or `null` when the pixels are
 * unreadable (the picker then falls back to the AABB hit, the pre-mask behaviour).
 */
export function alphaMaskOf(source: TextureSource): AlphaMask | null {
  const cached = maskCache.get(source);
  if (cached !== undefined) return cached;
  const resource: unknown = source.resource;
  const mask = isDrawableResource(resource)
    ? (() => {
        const pixels = readPixels(resource, source.pixelWidth, source.pixelHeight);
        return pixels === null ? null : buildAlphaMask(pixels.data, pixels.width, pixels.height);
      })()
    : null;
  maskCache.set(source, mask);
  return mask;
}
