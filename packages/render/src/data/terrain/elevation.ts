import { halfCellToScreen, TILE_HALF_H } from '../projection/index.js';
import { makeCellSampler } from './cell-field.js';
import { nodeCell } from './tessellation.js';

/**
 * The terrain-elevation seam. The map's `lmhe` lane is a per-cell height (0..~250 corpus-wide,
 * `content/maps/<id>.json` `elevation`). Observed map alignment pins each mesh node to elevation/16
 * half-row-steps, i.e. `TILE_HALF_H/32` px per elevation unit (1.1875 px at the measured 38 px row
 * step). The bilinear core is shared with the brightness lane (`cell-field.ts`) so lift and shading
 * sample identically.
 *
 * Render-only: the sim never reads elevation, so the lift stays out of golden state.
 */

/** Elevation units per half row step of lift, from the observed map alignment above. */
const ELEVATION_UNITS_PER_HALF_ROW_STEP = 16;

/**
 * World px of upward lift per elevation unit. A positive value is subtracted from a projected `y`
 * (screen up is −y).
 */
export function elevationLiftPerUnit(): number {
  return TILE_HALF_H / 2 / ELEVATION_UNITS_PER_HALF_ROW_STEP;
}

/** An immutable height field over a `width×height` per-cell `elevation` grid. */
export interface ElevationField {
  /**
   * The map-wide maximum lift in world px, and the cull pad: chunk AABBs and the viewport are grown by
   * it so a lifted-up chunk or sprite is never clipped by culling. 0 for a flat field.
   */
  readonly maxLift: number;
  /**
   * The upward lift (world px, ≥ 0) to subtract from a projected `y` at a continuous cell coordinate -
   * bilinear and edge-clamped, and exactly the cell's own lift at an integer coordinate, so it agrees
   * with the ground mesh's node vertices.
   */
  liftAt(col: number, row: number): number;
  /**
   * {@link liftAt} for a half-cell node address, owning the node→cell-space convention so node
   * consumers cannot drift apart on it. On a cell row (even `hy`) the parity-corrected column returns
   * exactly the value the ground mesh bakes at that vertex; between rows the plain bilinear stands in,
   * a named approximation of the triangle plane.
   */
  liftAtNode(hx: number, hy: number): number;
}

/**
 * The terrain lift (world px to subtract from a projected feet `y`) at a continuous cell coordinate, or
 * 0 when the field is flat or absent. The one home for that guard, so consumers cannot drift on it.
 */
export function terrainLiftAt(elevation: ElevationField | undefined, col: number, row: number): number {
  return elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAt(col, row) : 0;
}

/**
 * {@link terrainLiftAt} for a half-cell node address, for overlay layers that place their decals on the
 * node lattice rather than at continuous tile coordinates.
 */
export function terrainLiftAtNode(elevation: ElevationField | undefined, hx: number, hy: number): number {
  return elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAtNode(hx, hy) : 0;
}

/**
 * A half-cell node's lifted screen point: {@link halfCellToScreen} with the terrain height under the
 * node subtracted from `y`. The shared project-then-lift primitive for world-space node overlays.
 */
export function projectNode(
  elevation: ElevationField | undefined,
  hx: number,
  hy: number,
): { x: number; y: number } {
  const p = halfCellToScreen(hx, hy);
  return { x: p.x, y: p.y - terrainLiftAtNode(elevation, hx, hy) };
}

/** The shared flat field - no elevation lane, so a map without one allocates nothing. */
const FLAT_FIELD: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };

/**
 * Build an {@link ElevationField} from a decoded map's `elevation` lane (row-major, length
 * `width·height`); an absent or empty lane yields the flat field, keeping every non-elevation consumer
 * byte-identical. Closes over the array by reference, never mutating it.
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
      // A centre node samples its own cell, matching the mesh vertex; a node between centres has no
      // cell of its own, so it samples the unstaggered column.
      if (Number.isInteger(row)) {
        const [col] = nodeCell(hx, hy);
        return sample(col, row) * liftPerUnit;
      }
      return sample(hx / 2, row) * liftPerUnit;
    },
  };
}
