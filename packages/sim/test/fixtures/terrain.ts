import { halfCellMapFromCells, type TerrainMap } from '../../src/index.js';

/** Ground type id 0 in the synthetic fixtures — plain walkable grass. */
const GRASS = 0;

/**
 * All-grass map given in CELL dimensions: `width × height` cells upsampled through
 * `halfCellMapFromCells` to the `2W×2H` half-cell lattice the sim runs on. Use this when a test
 * thinks in cells (the common case).
 */
export function grassCellMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

/**
 * All-grass map given in RAW half-cell node dimensions — `width × height` is already the node
 * lattice, no upsampling. This is a 2× finer coordinate space than {@link grassCellMap}; the two are
 * NOT interchangeable. Use this only when a test addresses individual half-cell nodes.
 */
export function grassNodeMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}
