import { decodePcx, expandToRgba } from '../../decoders/pcx.js';
import { encodePng } from '../../decoders/png.js';

/**
 * The shipped minimaps' filler is palette index 0, not one RGB. Source basis: observed across all 70
 * `minimap.pcx` in the owned copy — every corner pixel is index 0, while its RGB varies (magenta
 * 255,0,255 on 65, blue 0,0,255 on the 3 `oasis_o_plenty` copies, brown 180,120,87 on the 2 non-350×160
 * ones), so an RGB colorkey would leave some fillers opaque.
 */
const MINIMAP_FILLER_INDEX = 0;

/**
 * Decodes a map folder's `minimap/minimap.pcx` into the emitted thumbnail PNG. The map is rendered
 * into a sub-rectangle of the canvas (usually 350×160) and the rest is filled with
 * {@link MINIMAP_FILLER_INDEX}; the same index also occurs as sparse speckles inside the map picture,
 * so only the border-connected index-0 region is keyed to transparent (a 4-neighbour flood fill from
 * the edges — a named approximation: the engine's own compositing is not oracle-documented, and this
 * reproduces "frame gone, picture intact" on the whole corpus). The result is cropped to the bounding
 * box of the surviving pixels, so the menu card shows the map, not the filler. Throws on a malformed
 * `.pcx` or an all-filler picture — the caller warns-and-skips per map.
 */
export function minimapToPng(bytes: Uint8Array): Uint8Array {
  const image = decodePcx(bytes);
  const { width, height, pixels } = image;

  // Flood-fill the border-connected filler region (4-neighbour, iterative).
  const keyed = new Uint8Array(width * height);
  const stack: number[] = [];
  const visit = (i: number): void => {
    if (keyed[i] === 0 && pixels[i] === MINIMAP_FILLER_INDEX) {
      keyed[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < (height - 1) * width) visit(i + width);
  }

  // Bounding box of the surviving (non-keyed) pixels.
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (keyed[y * width + x] === 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('pcx: minimap is entirely filler');

  const { rgba } = expandToRgba(image);
  for (let i = 0; i < keyed.length; i++) {
    if (keyed[i] === 1) rgba[i * 4 + 3] = 0;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cropped = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcStart = ((y + minY) * width + minX) * 4;
    cropped.set(rgba.subarray(srcStart, srcStart + w * 4), y * w * 4);
  }
  return encodePng({ width: w, height: h, rgba: cropped });
}
