import { decodePcx, expandToRgba } from '../../decoders/pcx.js';
import { encodePng } from '../../decoders/png.js';

/**
 * The shipped minimaps' filler is palette index 0, not one RGB. Source basis: observed across every
 * `minimap.pcx` in the owned copy - the corner pixel is always index 0 while its RGB varies between
 * magenta, blue and brown, so an RGB colorkey would leave some fillers opaque.
 */
const MINIMAP_FILLER_INDEX = 0;
const RGB_CHANNELS = 3;
const CHANNEL_FULL = 0xff;

/**
 * Whether the filler's colour is a colour key: every channel fully off or fully on, and not black or
 * white. Source basis: 63 of the 65 CnMod 1.3.2 minimaps use magenta or blue there, and their index-0
 * pixels enclosed by the picture are leftover filler, never painting; the two pictures with a brown
 * filler paint that brown inside the scene.
 */
function isColourKey(palette: Uint8Array, index: number): boolean {
  const rgb = palette.subarray(index * RGB_CHANNELS, (index + 1) * RGB_CHANNELS);
  const pure = rgb.every((channel) => channel === 0 || channel === CHANNEL_FULL);
  return pure && !(rgb[0] === rgb[1] && rgb[1] === rgb[2]);
}

/**
 * Decodes a map folder's `minimap/minimap.pcx` into the emitted picture PNG, cropped to the map
 * picture. A colour-key filler is keyed to transparent wherever it occurs, which clears the specks
 * the dissolved edges and erased spots leave enclosed in the picture. Any other filler colour also
 * paints the scene, so only its border-connected region is keyed: a 4-neighbour flood fill from the
 * edges. Both are named approximations of the engine's undocumented compositing. Keyed pixels are
 * transparent black, so a smooth scale cannot bleed the filler colour into the edge. Throws on a
 * malformed `.pcx` or an all-filler picture.
 */
export async function minimapToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const image = decodePcx(bytes);
  const { width, height, pixels, palette } = image;

  const keyed = new Uint8Array(width * height);
  if (palette !== undefined && isColourKey(palette, MINIMAP_FILLER_INDEX)) {
    for (let i = 0; i < keyed.length; i++) {
      if (pixels[i] === MINIMAP_FILLER_INDEX) keyed[i] = 1;
    }
  } else {
    keyBorderConnectedFiller(width, height, pixels, keyed);
  }

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
    if (keyed[i] === 1) rgba.fill(0, i * 4, i * 4 + 4);
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

function keyBorderConnectedFiller(
  width: number,
  height: number,
  pixels: Uint8Array,
  keyed: Uint8Array,
): void {
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
}
