/**
 * Shared in-memory image type for the asset pipeline. `RgbaImage` is the format-neutral currency between
 * the format decoders that produce pixels (`.pcx` now, `.bmd` later) and `encodePng` that writes them out.
 * It lives here, not in any one decoder, so a decoder never has to import another decoder just for the shape.
 */

/** Colours in a full 8-bit-indexed palette (`256` entries → the width of every RGB/RGBA colour table). */
export const PALETTE_ENTRIES = 256;

/**
 * Byte length of a 256-entry RGB palette (`256 × 3`) — the format-neutral colour-table currency the
 * `.pcx` trailer, the standalone `CPalette`, the `.bmd` atlas colouring, and the cursor DIB all
 * exchange. One name so the `768` magic literal never recurs per decoder.
 */
export const PALETTE_RGB_BYTES = PALETTE_ENTRIES * 3;

/**
 * Guards that `palette` is exactly one full RGB palette ({@link PALETTE_RGB_BYTES}), throwing a
 * `${prefix}:`-namespaced error otherwise — the single copy of the length check every indexed decoder
 * (`atlas`/`cursor`/`pcx`/`palette`/`player-palette`) ran inline. A wrong length is a programmer error
 * (decoded palettes are always 768 bytes), not recoverable input. `what` names the offending buffer for
 * callers that validate more than one (e.g. `player-palette`'s base vs source).
 */
export function assertPaletteBytes(palette: Uint8Array, prefix: string, what = 'palette'): void {
  if (palette.length !== PALETTE_RGB_BYTES) {
    throw new Error(
      `${prefix}: ${what} must be ${PALETTE_RGB_BYTES} bytes (256 RGB triples), got ${palette.length}`,
    );
  }
}

/** A pixel buffer in straight (non-premultiplied) RGBA, 8 bits/channel, row-major top→bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA bytes, length `width * height * 4`. */
  readonly rgba: Uint8Array;
}

/**
 * Expands palette indices into straight RGBA bytes: each index → its `[R,G,B]` from a 768-byte RGB
 * palette, with alpha from `alphaOf(i)`. An alpha of `0` leaves that pixel fully transparent (RGB stays
 * `0` too), so a caller with per-pixel coverage skips unwritten pixels by returning `0` for them. The
 * shared index→RGBA fill behind the `.pcx` picture (opaque, `alphaOf` returns `0xff`) and the `.bmd` bob
 * frame (per-pixel coverage) expansions. Callers validate the palette length before calling.
 */
export function paletteToRgba(
  pixels: Uint8Array,
  palette: Uint8Array,
  alphaOf: (index: number) => number,
): Uint8Array {
  const rgba = new Uint8Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const a = alphaOf(i);
    if (a === 0) continue;
    const p = (pixels[i] ?? 0) * 3;
    const o = i * 4;
    rgba[o] = palette[p] ?? 0;
    rgba[o + 1] = palette[p + 1] ?? 0;
    rgba[o + 2] = palette[p + 2] ?? 0;
    rgba[o + 3] = a;
  }
  return rgba;
}
