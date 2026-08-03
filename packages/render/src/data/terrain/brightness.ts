import { makeCellSampler } from './cell-field.js';

/**
 * The terrain-brightness seam: the decoded map's `embr` lane (`content/maps/<id>.json` `brightness`,
 * per-cell u8) as a multiplicative shading field over the ground. The lane is the original's pre-baked
 * shading plane - slope light and shadow over the hills plus the fade-to-black map border (the
 * outermost 2-3 rows and columns hold 0) - so carrying it verbatim reproduces both looks without
 * inventing a lighting model.
 *
 * The response curve is calibrated by observation against the reference corpus: it is linear,
 * luminance × embr/{@link BRIGHTNESS_NEUTRAL} with no offset, so values above neutral brighten (255 ≈
 * 2×) and a shader must not clamp the multiplier at 1.
 *
 * Only the ground and landscape objects take the lane; buildings and settlers draw unshaded as in the
 * original, whose bob-print core (`CBobManager.PrintBob_8BitCore`/`PrintBob_DoubleByteCore`) takes no
 * brightness argument. The mesh samples the lane per fragment from an R8 texture (`gpu/shading.ts`);
 * this module is the CPU-side sampler for everything else. Render-only: the sim never reads it.
 */

/**
 * The lane value that leaves a texel unchanged. Measured, not assumed: the flat-ground histogram peaks
 * at 127 and the corpus regression resolves 1/slope = 127.3 with ~zero intercept. Lane values map to
 * `value / 127`, so 0 = black (the map border) and 255 ≈ 2×.
 */
export const BRIGHTNESS_NEUTRAL = 127;

/**
 * An immutable per-cell brightness field - the CPU twin of the ground shader's texture sampling, and
 * bound to it: same bilinear, same edge clamp.
 */
export interface BrightnessField {
  /** False when the map has no lane, so consumers skip the shading work entirely. */
  readonly shaded: boolean;
  /**
   * The luminance multiplier (≥ 0, 1 = unchanged) at a continuous cell coordinate - bilinear over the
   * per-cell grid ÷ {@link BRIGHTNESS_NEUTRAL}, clamped at the map edges.
   */
  brightnessAt(col: number, row: number): number;
}

/** The neutral field - no brightness lane. Shared so an unshaded map allocates nothing. */
const NEUTRAL_FIELD: BrightnessField = { shaded: false, brightnessAt: () => 1 };

/**
 * Build a {@link BrightnessField} from a decoded map's `brightness` lane (row-major, length
 * `width·height`); an absent or empty lane yields the neutral field, keeping the unshaded mesh path
 * byte-identical. Closes over the array by reference, never mutating it.
 */
export function makeBrightnessField(
  brightness: readonly number[] | undefined,
  width: number,
  height: number,
): BrightnessField {
  if (brightness === undefined || brightness.length === 0 || width <= 0 || height <= 0) {
    return NEUTRAL_FIELD;
  }
  const sample = makeCellSampler(brightness, width, height);
  return {
    shaded: true,
    brightnessAt: (col: number, row: number): number => sample(col, row) / BRIGHTNESS_NEUTRAL,
  };
}

/**
 * Scale an `0xRRGGBB` colour's channels by `factor`, clamped to white - the CPU twin of the shader
 * multiply, for draws that cannot carry the lane per fragment.
 */
export function scaleColour(colour: number, factor: number): number {
  if (factor === 1) return colour;
  const ch = (shift: number): number => {
    const scaled = Math.round(((colour >> shift) & 0xff) * factor);
    return (scaled > 0xff ? 0xff : scaled) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}
