import { diamondCornerSamples, makeCellSampler } from './cell-field.js';

/**
 * The ONE terrain-elevation seam: a pure, immutable height field with a single bilinear sampler every
 * render consumer goes through (the terrain mesh, map objects, entity sprites, the cull pad, picking).
 * The bilinear+clamp core and the watertight diamond-corner coordinates are shared with the brightness
 * lane (`cell-field.ts`) so lift and shading sample identically. No Pixi, no canvas — plain math,
 * unit-tested headlessly like the rest of `render`'s data layer.
 *
 * The map's `lmhe` lane is a per-CELL height (0..~250 observed corpus-wide, `content/maps/<id>.json` `elevation`). The
 * original lifts the projected world UP by a fixed factor per unit — screen_y = projected_y − LIFT·elev
 * — which is what makes hills read as hills and collapses the vertical mismatch vs the corpus (buildings
 * on the hill sat ~25–40 px off). The factor is MEASURED (source basis "projection"): the building
 * lattice fit resolves the elevation term at E = 1.547 IMAGE px/unit at the corpus's 1.25× capture scale
 * (y-rms 5.0→1.2 with the term), i.e. {@link ELEVATION_LIFT} native art px/unit.
 *
 * Determinism note: this is render-only. The sim never reads elevation — the lift lives entirely in the
 * projection, so two runs from one seed stay byte-identical (the golden tests don't see it).
 */

/** The fitted vertical lift in IMAGE px per elevation unit, at the corpus's capture scale (source basis "projection"). */
const FITTED_LIFT_IMG_PX = 1.547;
/** The corpus capture scale the fit was measured at (five independent building templates peak at 1.25×). */
const CORPUS_CAPTURE_SCALE = 1.25;

/**
 * Native art px of UPWARD lift per elevation unit — the fitted image lift ÷ the capture scale (≈1.24).
 * In the same native-pixel space as the cell pitch ({@link import('./iso.js').TILE_HALF_W}), so at the
 * verification zoom 1.25× it renders back as the fitted 1.547 image px. A positive value is SUBTRACTED
 * from a projected `y` (screen up is −y).
 */
export const ELEVATION_LIFT = FITTED_LIFT_IMG_PX / CORPUS_CAPTURE_SCALE;

/**
 * An immutable terrain height field over a `width×height` per-cell `elevation` grid, exposing the ONE
 * bilinear lift sampler. A field with no elevation lane (synthetic maps, a `content/`-less checkout) is
 * FLAT — {@link liftAt} returns 0 and {@link maxLift} is 0 — so every non-elevation consumer stays
 * byte-identical. Pure + total.
 */
export interface ElevationField {
  /**
   * The map-wide maximum lift in world px (`max(elevation)·LIFT`), computed once. The cull pad: chunk
   * AABBs + the viewport are grown by this so a lifted-up chunk/sprite is never clipped by culling. 0
   * for a flat field.
   */
  readonly maxLift: number;
  /**
   * The upward lift (world px, ≥ 0) at a CONTINUOUS cell coordinate `(col, row)` — bilinear over the
   * per-cell grid, clamped at the map edges (a sample past an edge repeats the edge cell). Fractional
   * inputs (a walking settler, a diamond corner between cell centres) interpolate — no snapping. The
   * value to SUBTRACT from the projected `y`.
   */
  liftAt(col: number, row: number): number;
  /**
   * {@link liftAt} for a HALF-CELL NODE address `(hx, hy)`: the elevation lane is per-CELL, and a
   * node sits at `(hx/2, hy/2)` in continuous cell space — this owns that ÷2 convention so node
   * consumers (placement overlay/ghost, picking) can't drift apart on it.
   */
  liftAtNode(hx: number, hy: number): number;
}

/** A flat field — no elevation lane. Shared so a `content/`-less / synthetic map allocates nothing. */
const FLAT_FIELD: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };

/**
 * Build an {@link ElevationField} from a decoded map's `elevation` lane (row-major, length
 * `width·height`). An absent/empty lane yields the shared flat field (zero lift everywhere). The field
 * closes over the array by reference (never mutated) — cheap to build, so a consumer may build its own.
 */
export function makeElevationField(
  elevation: readonly number[] | undefined,
  width: number,
  height: number,
): ElevationField {
  if (elevation === undefined || elevation.length === 0 || width <= 0 || height <= 0) return FLAT_FIELD;

  let maxElev = 0;
  for (const e of elevation) if (e > maxElev) maxElev = e;
  const maxLift = maxElev * ELEVATION_LIFT;

  const sample = makeCellSampler(elevation, width, height);
  return {
    maxLift,
    liftAt: (col: number, row: number): number => sample(col, row) * ELEVATION_LIFT,
    liftAtNode: (hx: number, hy: number): number => sample(hx / 2, hy / 2) * ELEVATION_LIFT,
  };
}

/**
 * The four diamond-corner lifts `[top, right, bottom, left]` (world px) for terrain cell `(col, row)`,
 * for baking into the ground mesh — {@link diamondCornerSamples} over the lift sampler, so a corner
 * SHARED by up to four diamonds lifts identically from every owner and the mesh stays crack-free (the
 * canonical-coordinate argument lives with the shared corner math in `cell-field.ts`). Pure.
 */
export function diamondCornerLifts(
  field: ElevationField,
  col: number,
  row: number,
): [number, number, number, number] {
  return diamondCornerSamples((c, r) => field.liftAt(c, r), col, row);
}
