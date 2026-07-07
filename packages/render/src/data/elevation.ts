/**
 * The ONE terrain-elevation seam: a pure, immutable height field with a single bilinear sampler every
 * render consumer goes through (the terrain mesh, map objects, entity sprites, the cull pad, picking).
 * No Pixi, no canvas — plain math, unit-tested headlessly like the rest of `render`'s data layer.
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
}

/** A flat field — no elevation lane. Shared so a `content/`-less / synthetic map allocates nothing. */
const FLAT_FIELD: ElevationField = { maxLift: 0, liftAt: () => 0 };

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

  // Clamp-to-edge integer lookup: a sample past an edge repeats the boundary cell (no wrap, no OOB).
  const at = (col: number, row: number): number => {
    const c = col < 0 ? 0 : col >= width ? width - 1 : col;
    const r = row < 0 ? 0 : row >= height ? height - 1 : row;
    return elevation[r * width + c] ?? 0;
  };

  return {
    maxLift,
    liftAt(col: number, row: number): number {
      const c0 = Math.floor(col);
      const r0 = Math.floor(row);
      const tx = col - c0;
      const ty = row - r0;
      const e00 = at(c0, r0);
      const e10 = at(c0 + 1, r0);
      const e01 = at(c0, r0 + 1);
      const e11 = at(c0 + 1, r0 + 1);
      const top = e00 + (e10 - e00) * tx;
      const bot = e01 + (e11 - e01) * tx;
      return (top + (bot - top) * ty) * ELEVATION_LIFT;
    },
  };
}

/**
 * The four diamond-corner lifts `[top, right, bottom, left]` (world px) for terrain cell `(col, row)`,
 * for baking into the ground mesh. Each corner sits BETWEEN cell centres and is SHARED by up to four
 * diamonds; the lift must be identical from every sharing cell or the mesh cracks. It is, because each
 * corner is sampled at a CANONICAL continuous cell coordinate that is a pure function of the corner's
 * position in the staggered raster, not of which cell references it:
 *
 *   a vertex at raster lattice `(X, Y)` (cell centres have `X = 2·col + (row&1)`, `Y = row`) maps to
 *   `(col, row) = ((X − (Y&1))/2, Y)` — so a shared corner resolves to the SAME `(col, row)` (hence the
 *   same bilinear sample) from either owner. Worked per corner of `(col, row)` with `s = row&1`:
 *     top    → ({@link liftAt} at col+s−0.5, row−1)   bottom → (col+s−0.5, row+1)
 *     right  → (col+0.5, row)                          left   → (col−0.5, row)
 *
 * At an integer row the bilinear degenerates to a linear blend of the two cells straddling the corner —
 * a smooth, watertight height field. Pure.
 */
export function diamondCornerLifts(
  field: ElevationField,
  col: number,
  row: number,
): [number, number, number, number] {
  const s = row & 1;
  return [
    field.liftAt(col + s - 0.5, row - 1), // top
    field.liftAt(col + 0.5, row), // right
    field.liftAt(col + s - 0.5, row + 1), // bottom
    field.liftAt(col - 0.5, row), // left
  ];
}
