/**
 * `map.dat` half-cell landscape reduction: collapses the `lmlt` half-cell landscape-object lane into
 * the per-cell landscape-typeId grid the sim's nav graph consumes.
 *
 * The landscape lanes (`lmlt`, `lmlv`, `emla`, …) are plain row-major `2·width × 2·height` grids
 * rather than per-cell corner quads, observed by rendering a lane as a `2W × 2H` image. Cell (x, y)
 * owns half-cells `(2x, 2y)`, `(2x+1, 2y)`, `(2x, 2y+1)`, `(2x+1, 2y+1)`; landscape objects sit on
 * that finer lattice (`emla`) and `lmlt` mirrors each placed object's logic type onto it.
 */

import type { MapDatSize } from './container.js';
import type { MapLayer } from './layers.js';

export const HALF_CELLS_PER_CELL = 4;

/**
 * The `lmlt` value marking a half-cell with no landscape object. Raw non-zero values are the IR
 * `LandscapeType.typeId` directly (1-based, as in the readable `landscapetypes.ini`), pinned by the
 * `[GfxLandscape]` records' explicit `LogicType`: every `"clay mine …"` object carries `LogicType 12`
 * (`mud_mine`, typeId 12) and the probed maps' clay half-cells hold raw `12` with matching counts.
 */
const LMLT_EMPTY = 0;

/** The IR `LandscapeType.typeId` an empty half-cell reduces to: `void`, the "nothing here" type. */
export const VOID_TYPE_ID = 1;

/**
 * Reduces a cell's four half-cell values to their dominant value, ties broken by the lowest so the
 * result never depends on half-cell order.
 */
export function reduceHalfCellsToCell(c0: number, c1: number, c2: number, c3: number): number {
  const values = [c0, c1, c2, c3];
  let best = c0;
  let bestCount = 0;
  for (const candidate of values) {
    let count = 0;
    for (const other of values) if (other === candidate) count++;
    if (count > bestCount || (count === bestCount && candidate < best)) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export interface MapDatTerrainMap {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell; length === width × height. */
  readonly typeIds: number[];
}

/**
 * Collapses an unpacked `lmlt` layer plus the `lsiz` dimensions into a per-cell landscape-typeId grid.
 * Each cell takes the {@link reduceHalfCellsToCell} dominant of its 2×2 half-cell block, with
 * {@link LMLT_EMPTY} mapped to {@link VOID_TYPE_ID}. The result is a plain value rather than a sim type
 * so the build tool never imports from `sim`. Throws when the layer length isn't `width × height × 4`.
 *
 * Approximation: the original's half-cell to cell reduction is not established, and dominant-value is
 * a deterministic stand-in.
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
