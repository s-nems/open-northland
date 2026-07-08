import { makeCellSampler } from './cell-field.js';

/**
 * The terrain-brightness seam: the decoded map's `embr` lane (`content/maps/<id>.json` `brightness`,
 * per-cell u8) as a multiplicative shading field over the ground. The lane is the original's
 * PRE-BAKED shading plane — slope light/shadow over the hills plus the fade-to-black map border (the
 * outermost 2–3 rows/columns hold 0) — so carrying it verbatim reproduces both looks without
 * inventing a lighting model. The ground mesh samples it per FRAGMENT from an R8 texture at
 * canonical-cell-coordinate UVs (`gpu/terrain/shaded-mesh.ts`); this module's bilinear field is the
 * CPU-side sampler for everything else (the flat fallback, the map-object anchors, tests).
 *
 * The response curve is CALIBRATED BY OBSERVATION against the reference corpus (mosty-5, capture
 * 1.25×): regressing luminance(original)/luminance(our unshaded render) against `embr` over 50
 * aligned open-ground cells fits ratio = embr/127.3 − 0.06 (rms 0.37, dominated by texture variance;
 * the border's embr=0 cells are literally black in the original). That pins the engine's curve as
 * the linear luminance × embr/{@link BRIGHTNESS_NEUTRAL} with no offset — values ABOVE 127 brighten
 * (up to 255 ≈ 2×), so the shaders must not clamp the multiplier at 1. Landscape OBJECTS are shaded
 * too, with one measured exception: mine decals, stones and grass track the lane (masked opaque-pixel
 * ratio ×0.58 → ×1.58 across it), while TREE canopies stay full-bright even anchored on embr=0 border
 * cells (flat regression over 118 canopies) — the app's object loader applies the anchor-cell
 * multiplier to everything but the tree logic types (`content/objects.ts`). Buildings/settlers are
 * unmeasured (the corpus base sits near neutral) and stay unshaded.
 *
 * Determinism note: render-only, like the elevation lift — the sim never reads brightness.
 */

/**
 * The lane value that leaves a texel unchanged (multiplier 1). MEASURED, not assumed: the flat-ground
 * histogram peaks at 127 and the corpus regression resolves 1/slope = 127.3 with ~zero intercept
 * (see the module note). Lane values map to `value / 127` — 0 = black (the map border), 255 ≈ 2×.
 */
export const BRIGHTNESS_NEUTRAL = 127;

/**
 * An immutable per-cell brightness field exposing the ONE bilinear multiplier sampler (the CPU twin
 * of the shaded ground shader's texture sampling — same bilinear, same edge clamp). A field with no
 * lane (synthetic maps, older saves) is NEUTRAL — {@link shaded} is false and {@link brightnessAt}
 * returns 1 — so the unshaded mesh path stays byte-identical. Pure + total.
 */
export interface BrightnessField {
  /** False for the shared neutral field (no lane) — consumers skip the shading work entirely. */
  readonly shaded: boolean;
  /**
   * The luminance multiplier (≥ 0, 1 = unchanged) at a CONTINUOUS cell coordinate `(col, row)` —
   * bilinear over the per-cell grid ÷ {@link BRIGHTNESS_NEUTRAL}, clamped at the map edges.
   */
  brightnessAt(col: number, row: number): number;
}

/** The neutral field — no brightness lane. Shared so an unshaded map allocates nothing. */
const NEUTRAL_FIELD: BrightnessField = { shaded: false, brightnessAt: () => 1 };

/**
 * Build a {@link BrightnessField} from a decoded map's `brightness` lane (row-major, length
 * `width·height`). An absent/empty lane yields the shared neutral field (multiplier 1 everywhere).
 * The field closes over the array by reference (never mutated).
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
 * Scale an `0xRRGGBB` colour's channels by `factor` (clamped to white) — the CPU twin of the shader
 * multiply, for draws that can't carry the lane per fragment: the unbound-cell fallback diamond, the
 * flat placeholder tint, and the tall map-object sprite tint.
 */
export function scaleColour(colour: number, factor: number): number {
  if (factor === 1) return colour;
  const ch = (shift: number): number => {
    const scaled = Math.round(((colour >> shift) & 0xff) * factor);
    return (scaled > 0xff ? 0xff : scaled) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}
