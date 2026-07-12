import { makeCellSampler } from './cell-field.js';
import { TILE_HALF_H } from './iso.js';

/**
 * The ONE terrain-elevation seam: a pure, immutable height field with a single bilinear sampler every
 * render consumer goes through (the terrain mesh, map objects, entity sprites, the cull pad, picking).
 * The bilinear+clamp core is shared with the brightness lane (`cell-field.ts`) so lift and shading
 * sample identically. No Pixi, no canvas — plain math, unit-tested headlessly like the rest of
 * `render`'s data layer.
 *
 * The map's `lmhe` lane is a per-CELL height (0..~250 observed corpus-wide, `content/maps/<id>.json`
 * `elevation`). The original lifts each mesh node UP by **elevation/16 half-row-steps** — the engine
 * tessellation's exact divisor (source basis, docs/SOURCES.md "terrain tessellation"), i.e.
 * `TILE_HALF_H/32` px per elevation unit (1.1875 px at the measured 38 px row step; supersedes the
 * earlier photogrammetric fit of ≈1.24, which ran ≈4% higher). The ground mesh samples nodes
 * exactly (`terrain.ts` `nodeLift`); sprites/objects at fractional positions ride the bilinear
 * sampler here — a named approximation of the mesh's piecewise-triangle surface: {@link
 * ElevationField.liftAt} is exact at integer CELL coordinates, {@link ElevationField.liftAtNode}
 * exact at every same-row node (centres and mid-edge points), and only between-row nodes / interior
 * fractional positions blend bilinearly where the mesh is triangle-planar.
 *
 * Determinism note: this is render-only. The sim never reads elevation — the lift lives entirely in the
 * projection, so two runs from one seed stay byte-identical (the golden tests don't see it).
 */

/** Elevation units per HALF row step of lift — the engine tessellation's divisor (source basis above). */
const ELEVATION_UNITS_PER_HALF_ROW_STEP = 16;

/**
 * World px of UPWARD lift per elevation unit — `TILE_HALF_H/2` px per half-row-step ÷ the engine's
 * 16 units per step. Reads the LIVE row step ({@link TILE_HALF_H} is `?pitchy`-tunable), so it must
 * be read at field-build time, after `setTilePitch`. A positive value is SUBTRACTED from a
 * projected `y` (screen up is −y).
 */
export function elevationLiftPerUnit(): number {
  return TILE_HALF_H / 2 / ELEVATION_UNITS_PER_HALF_ROW_STEP;
}

/**
 * An immutable terrain height field over a `width×height` per-cell `elevation` grid, exposing the ONE
 * bilinear lift sampler. A field with no elevation lane (synthetic maps, a `content/`-less checkout) is
 * FLAT — {@link liftAt} returns 0 and {@link maxLift} is 0 — so every non-elevation consumer stays
 * byte-identical. Pure + total.
 */
export interface ElevationField {
  /**
   * The map-wide maximum lift in world px (`max(elevation)·liftPerUnit`), computed once. The cull pad:
   * chunk AABBs + the viewport are grown by this so a lifted-up chunk/sprite is never clipped by
   * culling. 0 for a flat field.
   */
  readonly maxLift: number;
  /**
   * The upward lift (world px, ≥ 0) at a CONTINUOUS cell coordinate `(col, row)` — bilinear over the
   * per-cell grid, clamped at the map edges (a sample past an edge repeats the edge cell). Fractional
   * inputs (a walking settler, a position between cell centres) interpolate — no snapping. At an
   * INTEGER cell coordinate this is exactly the cell's own lift, so it agrees with the ground mesh's
   * node vertices. The value to SUBTRACT from the projected `y`.
   */
  liftAt(col: number, row: number): number;
  /**
   * {@link liftAt} for a HALF-CELL NODE address `(hx, hy)` — this owns the node→cell-space
   * convention so node consumers (placement overlay/ghost, picking, map objects) can't drift apart
   * on it. On a CELL row (even `hy`) the column is parity-corrected (`(hx − (row&1))/2`), so a
   * cell-centre node returns exactly its cell's lift — the same value the ground mesh bakes at
   * that vertex — and a mid-edge node the exact two-cell blend of the mesh edge. Between rows
   * (odd `hy`, inside the mesh triangles) the plain `(hx/2, hy/2)` bilinear stands in — a named
   * approximation of the triangle plane.
   */
  liftAtNode(hx: number, hy: number): number;
}

/**
 * The terrain lift (world px to SUBTRACT from a projected feet `y`) at a continuous cell coordinate, or 0
 * when there is nothing to sample. Folds the flat-map fast path (`maxLift === 0` skips the sampler) and the
 * absent-field case that the live-entity and ghost projection both apply, so the two can't drift on the
 * guard. Pure.
 */
export function terrainLiftAt(elevation: ElevationField | undefined, col: number, row: number): number {
  return elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAt(col, row) : 0;
}

/**
 * {@link terrainLiftAt} for a HALF-CELL NODE address `(hx, hy)` — the twin the world-space overlay
 * layers (placement overlay/ghost, construction plots, geometry debug) need, since they place their
 * decals on the node lattice rather than continuous tile coords. Same flat-map + absent-field guard,
 * so every node consumer folds `maxLift > 0` here instead of re-inlining it. Pure.
 */
export function terrainLiftAtNode(elevation: ElevationField | undefined, hx: number, hy: number): number {
  return elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAtNode(hx, hy) : 0;
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
  const liftPerUnit = elevationLiftPerUnit();
  const maxLift = maxElev * liftPerUnit;

  const sample = makeCellSampler(elevation, width, height);
  return {
    maxLift,
    liftAt: (col: number, row: number): number => sample(col, row) * liftPerUnit,
    liftAtNode: (hx: number, hy: number): number => {
      const row = hy / 2;
      if (Number.isInteger(row)) {
        // On a cell row the staggered lattice puts cell centres at hx = 2·col + (row&1): undo the
        // parity so a centre node samples ITS OWN cell (matching the mesh vertex) and a mid-edge
        // node the exact straddling blend.
        return sample((hx - (row & 1)) / 2, row) * liftPerUnit;
      }
      return sample(hx / 2, row) * liftPerUnit;
    },
  };
}
