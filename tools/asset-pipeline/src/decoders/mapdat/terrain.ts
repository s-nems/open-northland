/**
 * `map.dat` half-cell landscape reduction — collapses the `lmlt` `2W × 2H` half-cell landscape-object
 * lane into the per-cell landscape-typeId grid the sim's nav graph consumes.
 *
 * The landscape grid lanes (`lmlt`, `lmlv`, `emla`, …) carry 4 values per map cell — but not as
 * per-cell corner quads: each lane is a plain row-major `2·width × 2·height` half-cell grid
 * (pinned empirically: rendering `lmlt`/`emla` as a `2W × 2H` image draws the map's island shapes
 * cleanly, while a per-cell 2×2 interleave draws two side-by-side half-resolution copies — the tell
 * that consecutive values run along a `2W` row, not around one cell). A map cell (x, y) owns the four
 * half-cells `(2x, 2y)`, `(2x+1, 2y)`, `(2x, 2y+1)`, `(2x+1, 2y+1)`; landscape objects sit on this
 * finer lattice (`emla`), and `lmlt` mirrors each placed object's logic type onto it.
 */

import type { MapDatSize } from './container.js';
import type { MapLayer } from './layers.js';

export const HALF_CELLS_PER_CELL = 4;

/**
 * The `lmlt` value marking a half-cell with no landscape object (the lane's dominant value —
 * open ground/sea). Raw non-zero values are the IR `LandscapeType.typeId` directly (1-based, as
 * in the readable `landscapetypes.ini`): pinned by the `[GfxLandscape]` records' explicit `LogicType`
 * — e.g. every `"clay mine …"` object carries `LogicType 12` (`mud_mine`, typeId 12) and the probed
 * maps' clay half-cells hold raw `12` with matching counts (`palm` → `LogicType 4` = `tree`,
 * `"fx wave …"` → `LogicType 1` = `void`, exact count matches across lanes). An earlier reading
 * (+1-shifted 0-based indices) mapped every object one row off (tree → tree_falling) — see
 * source basis.
 */
export const LMLT_EMPTY = 0;

/**
 * The IR `LandscapeType.typeId` an empty half-cell reduces to: `void` (typeId 1) — the "nothing
 * here" landscape type, so a grid built from the lane always resolves against the IR table.
 */
export const VOID_TYPE_ID = 1;

/**
 * Reduces a cell's four half-cell values to a single representative: the dominant (most
 * frequent) value, ties broken by the lowest (canonical + deterministic — never depends on
 * half-cell order). On a uniform cell (all four equal, the common case) it returns that value; on a
 * mixed cell it returns whichever value covers most of the cell.
 *
 * Pure helper for {@link lmltToTerrainMap}; exported for direct unit testing of the reduction rule.
 */
export function reduceHalfCellsToCell(c0: number, c1: number, c2: number, c3: number): number {
  const values = [c0, c1, c2, c3];
  let best = c0;
  let bestCount = 0;
  for (const candidate of values) {
    let count = 0;
    for (const other of values) if (other === candidate) count++;
    // Strictly-greater keeps the first (lowest-index) winner; the lowest-value tie-break is applied
    // explicitly so the result never depends on which half-cell happened to come first.
    if (count > bestCount || (count === bestCount && candidate < best)) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** A raw per-cell landscape map: dimensions + a row-major typeId grid (the cell-graph input). */
export interface MapDatTerrainMap {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell; length === width × height. */
  readonly typeIds: number[];
}

/**
 * Collapses an unpacked `lmlt` layer (the `2W × 2H` half-cell landscape-object lane) plus the `lsiz`
 * dimensions into a single per-cell landscape-typeId grid — the plain `{ width, height, typeIds }`
 * shape the sim's `buildTerrainGraph` (`packages/sim/src/terrain.ts`) consumes as a `TerrainMap`.
 * Each cell's type is the {@link reduceHalfCellsToCell} dominant of its 2×2 half-cell block; raw
 * values are the IR typeId directly ({@link LMLT_EMPTY} = no object → {@link VOID_TYPE_ID}). Returns
 * a plain value (not a sim type) so the build tool never imports from `sim`; the sim validates the
 * typeIds against its IR table.
 *
 * APPROXIMATED: the half-cell→cell reduction has no behavioral oracle (OpenVikings decodes the
 * container but does not simulate navigation). Dominant-value is a faithful-shaped, deterministic
 * choice for a bulk-terrain nav grid; refine if the oracle later pins a different rule. Walkability
 * itself is resolved downstream from the IR `LandscapeType` flags, not here.
 *
 * Throws if the layer length isn't exactly `width × height × 4` (a wrong layer / dims mismatch).
 */
export function lmltToTerrainMap(layer: MapLayer, size: MapDatSize): MapDatTerrainMap {
  const cells = size.width * size.height;
  const expected = cells * HALF_CELLS_PER_CELL;
  if (layer.cells.length !== expected) {
    throw new Error(
      `mapdat: lmlt layer has ${layer.cells.length} bytes, expected ${expected} (${size.width}×${size.height} × ${HALF_CELLS_PER_CELL} half-cells)`,
    );
  }
  const g = layer.cells;
  const hw = size.width * 2; // half-cell grid width (row-major 2W × 2H)
  const typeIds = new Array<number>(cells);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const top = 2 * y * hw + 2 * x;
      const bottom = (2 * y + 1) * hw + 2 * x;
      const raw = reduceHalfCellsToCell(
        g[top] as number,
        g[top + 1] as number,
        g[bottom] as number,
        g[bottom + 1] as number,
      );
      typeIds[y * size.width + x] = raw === LMLT_EMPTY ? VOID_TYPE_ID : raw;
    }
  }
  return { width: size.width, height: size.height, typeIds };
}
