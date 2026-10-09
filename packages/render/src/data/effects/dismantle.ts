import { clamp01 } from '../math.js';
import type { AtlasFrame, BuildTimeSheet } from '../sprites/index.js';
import { frac } from './random.js';

export interface DismantleSource {
  readonly frame: AtlasFrame;
  readonly times?: BuildTimeSheet;
  readonly window?: readonly [number, number];
  /** The progress actually visible at destruction, including an unfinished or upgrading layer. */
  readonly built: number;
  readonly seed: number;
}

/** The authored construction order, reversed. The margins keep the opening frame unchanged and
 * clear even time-zero foundation pixels before the ruin releases its materials. */
export function removalTime(timeByte: number, window: readonly [number, number], built: number): number {
  const installed = (window[0] + (timeByte / 255) * Math.max(0, window[1] - window[0])) / 100;
  return 0.035 + clamp01(1 - installed / Math.max(0.001, built)) * 0.9;
}

/** One retained GPU mask: red is removal time, green is a material-scale variation for the breaking
 * edge. Coordinates refer to the uncropped source, even when the last visible layer was cropped. */
export function dismantleMask(
  width: number,
  height: number,
  source: DismantleSource,
  left = 0,
  top = 0,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height * 4);
  const { frame, times, seed } = source;
  const window = source.window ?? [0, 100];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.round(x + left),
        sy = Math.round(y + top);
      const grit = frac(seed, Math.floor(sx / 3) + Math.floor(sy / 3) * 173);
      const time =
        sx >= 0 && sy >= 0 && sx < frame.width && sy < frame.height
          ? times?.values[(frame.y + sy) * times.width + frame.x + sx]
          : undefined;
      // Missing construction data erodes in place along a ragged roof-to-foundation front.
      const order = time ?? 255 * clamp01(1 - sy / Math.max(1, frame.height) + (grit - 0.5) * 0.12);
      const at = (y * width + x) * 4;
      mask[at] = 255 * removalTime(order, window, source.built);
      mask[at + 1] = grit * 255;
      mask[at + 2] = 0;
      mask[at + 3] = 255;
    }
  }
  return mask;
}
