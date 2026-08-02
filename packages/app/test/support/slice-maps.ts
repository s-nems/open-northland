import type { TerrainMapFile } from '@open-northland/data';
import { halfCellMapFromCells, type TerrainMap } from '@open-northland/sim';
import { GRASS } from '../../src/catalog/buildings.js';

/** The synthetic maps the slice tests run over - the one place their grids are described. */

/** A HALF-CELL grid (the sim's node resolution) with typeIds the synthetic strip never declares
 *  (5, 16, 22, …), cycling per node - folding those into the demo content is exactly what lets the sim's
 *  node-graph build over a real decoded map. */
export function mixedGrid(width: number, height: number): TerrainMap {
  return {
    resolution: 'half-cell',
    width,
    height,
    typeIds: Array.from({ length: width * height }, (_, i) => [5, 16, 22, 5][i % 4] as number),
  };
}

/** A 6×6 all-grass decoded map file, carrying `entities` when the case authors some. Its 12×12 node
 *  lattice is what the authored half-cell coords (0..11 per axis) bounds-check against. */
export function authoredMapFile(entities?: TerrainMapFile['entities']): TerrainMapFile {
  return {
    width: 6,
    height: 6,
    typeIds: new Array(36).fill(GRASS),
    ...(entities !== undefined ? { entities } : {}),
  };
}

/** {@link authoredMapFile} at the sim's node resolution. */
export function authoredMap(): TerrainMap {
  return halfCellMapFromCells(authoredMapFile());
}
