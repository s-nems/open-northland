import { halfCellMapFromCells, type TerrainMap } from '@open-northland/sim';

/** The synthetic maps the slice tests run over — the one place their grids are described. */

/** A HALF-CELL grid (the sim's node resolution) with typeIds the synthetic strip never declares
 *  (5, 16, 22, …), cycling per node — folding those into the demo content is exactly what lets the sim's
 *  node-graph build over a real decoded map. */
export function mixedGrid(width: number, height: number): TerrainMap {
  return {
    resolution: 'half-cell',
    width,
    height,
    typeIds: Array.from({ length: width * height }, (_, i) => [5, 16, 22, 5][i % 4] as number),
  };
}

/** A 6×6 all-grass CELL grid (demo typeId 5, walkable), upsampled to the sim's 12×12 node lattice —
 *  authored half-cell coords run 0..11 on each axis and bounds-check against those node dims. */
export function authoredMap(): TerrainMap {
  return halfCellMapFromCells({ width: 6, height: 6, typeIds: new Array(36).fill(5) });
}
