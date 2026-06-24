/**
 * Shared in-memory image type for the asset pipeline. `RgbaImage` is the format-neutral currency between
 * the format decoders that produce pixels (`.pcx` now, `.bmd` later) and `encodePng` that writes them out.
 * It lives here, not in any one decoder, so a decoder never has to import another decoder just for the shape.
 */

/** A pixel buffer in straight (non-premultiplied) RGBA, 8 bits/channel, row-major top→bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA bytes, length `width * height * 4`. */
  readonly rgba: Uint8Array;
}
