/**
 * Bob atlas bakes: how one decoded `.bmd` frame turns into sheet pixels. Index 0 is a real palette
 * colour for bobs, so alpha always comes from a frame's `mask`.
 */

import type { BobFrame } from '../bmd/index.js';
import { BOB_ALPHA_OPAQUE } from '../bmd/index.js';
import { assertPaletteBytes, paletteToRgba, type RgbaImage } from '../image.js';

/**
 * How an atlas reads a Double8Bit pair's second byte:
 *
 *  - `'per-pixel'`: the byte is coverage and bakes into the sheet's alpha as-is, keeping the decals'
 *    authored feathered translucency.
 *  - `'build-time'`: the byte is a 0-255 construction-progress threshold, not coverage. Measured on
 *    the `[GfxHouse]` bobs: it spans ~0-255 and is strongly row-correlated bottom-up (foundation low,
 *    roof high; ≈100 mean across solid walls). Every written pixel bakes fully opaque into the colour
 *    sheet, and the thresholds bake into a second, same-placement grayscale sheet a renderer reveals
 *    pixel by pixel as construction progresses.
 */
export type AtlasAlphaMode = 'per-pixel' | 'build-time';

/** Expands one decoded frame into one RGBA plane. Called only for frames that have pixels. */
type BobPlane = (frame: BobFrame) => RgbaImage;

/**
 * How a decoded bob turns into sheet pixels. `secondByte` is the reading `decodeBobFrame` applies to a
 * double-byte pair, and it is the tag: only a `'time'` bake also fills a build-progress plane.
 */
export type BobBake =
  | { readonly secondByte: 'alpha'; readonly plane: BobPlane }
  | { readonly secondByte: 'time'; readonly plane: BobPlane; readonly time: BobPlane };

/** Colours one decoded frame through a 256-entry RGB palette, taking alpha from its `mask`: unwritten
 *  is fully transparent, written carries its 0-255 coverage. */
export function expandBobFrame(frame: BobFrame, palette: Uint8Array): RgbaImage {
  assertPaletteBytes(palette, 'atlas');
  const { width, height, pixels, mask } = frame;
  return { width, height, rgba: paletteToRgba(pixels, palette, (i) => mask[i] ?? 0) };
}

/**
 * Palette index in red, `mask` in alpha, green/blue left 0. Colour is deferred to the renderer, which
 * reads each index through a per-player palette LUT so a clothing band recolours at draw time.
 */
export function expandBobFrameIndexed(frame: BobFrame): RgbaImage {
  const { width, height, pixels, mask } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const coverage = mask[i] ?? 0;
    if (coverage === 0) continue; // transparent: leave RGBA all-zero
    const o = i * 4;
    rgba[o] = pixels[i] ?? 0;
    rgba[o + 3] = coverage;
  }
  return { width, height, rgba };
}

/**
 * The build-progress plane of a `'time'`-decoded frame: R=G=B is the pixel's 0-255 threshold, alpha 255
 * where written and 0 elsewhere. Grayscale, so the emitted time sheet is inspectable by eye.
 */
function expandBobFrameTime(frame: BobFrame): RgbaImage {
  const { width, height, mask, time } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const t = time?.[i] ?? 0;
    const o = i * 4;
    rgba[o] = t;
    rgba[o + 1] = t;
    rgba[o + 2] = t;
    rgba[o + 3] = BOB_ALPHA_OPAQUE;
  }
  return { width, height, rgba };
}

/**
 * The baked alpha of a shadow-atlas pixel. An approximation: the original's shadow blit is not pinned
 * byte-level, so this adopts the value another reimplementation matched against the running original.
 */
export const SHADOW_ALPHA = 0x50;

/** Every written pixel black at {@link SHADOW_ALPHA}, every unwritten one fully transparent. No
 *  palette: the darkening belongs to the blit, not the art. */
function expandBobFrameShadow(frame: BobFrame): RgbaImage {
  const { width, height, mask } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if ((mask[i] ?? 0) === 0) continue; // transparent: leave RGBA all-zero
    rgba[i * 4 + 3] = SHADOW_ALPHA;
  }
  return { width, height, rgba };
}

export function colouredBake(palette: Uint8Array, alpha: AtlasAlphaMode): BobBake {
  const plane = (frame: BobFrame): RgbaImage => expandBobFrame(frame, palette);
  return alpha === 'build-time'
    ? { secondByte: 'time', plane, time: expandBobFrameTime }
    : { secondByte: 'alpha', plane };
}

export const INDEXED_BAKE: BobBake = { secondByte: 'alpha', plane: expandBobFrameIndexed };

export const SHADOW_BAKE: BobBake = { secondByte: 'alpha', plane: expandBobFrameShadow };
