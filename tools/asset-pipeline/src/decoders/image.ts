/**
 * Shared in-memory image type for the asset pipeline. `RgbaImage` is the format-neutral currency between
 * the format decoders that produce pixels (`.pcx` now, `.bmd` later) and `encodePng` that writes them out.
 * It lives here, not in any one decoder, so a decoder never has to import another decoder just for the shape.
 */

/**
 * Byte length of a 256-entry RGB palette (`256 × 3`) — the format-neutral colour-table currency the
 * `.pcx` trailer, the standalone `CPalette`, the `.bmd` atlas colouring, and the cursor DIB all
 * exchange. One name so the `768` magic literal never recurs per decoder.
 */
export const PALETTE_RGB_BYTES = 256 * 3;

/** A pixel buffer in straight (non-premultiplied) RGBA, 8 bits/channel, row-major top→bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA bytes, length `width * height * 4`. */
  readonly rgba: Uint8Array;
}
