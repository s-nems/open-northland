import { halfCellMapFromCells, type TerrainMap } from '../../src/index.js';

/** Ground type id 0 in the synthetic fixtures - plain walkable grass. */
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
 * All-grass map given in RAW half-cell node dimensions - `width × height` is already the node
 * lattice, no upsampling. This is a 2× finer coordinate space than {@link grassCellMap}; the two are
 * NOT interchangeable. Use this only when a test addresses individual half-cell nodes.
 */
export function grassNodeMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** Ground type id 1 in the synthetic fixtures - water, walkable by nothing. */
const WATER = 1;

/** {@link grassCellMap} with one full-height water column at cell column `column`, cutting the map in
 *  two banks no walk can cross. */
export function waterColumnMap(width: number, height: number, column: number): TerrainMap {
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++) typeIds[row * width + column] = WATER;
  return halfCellMapFromCells({ width, height, typeIds });
}

/** {@link grassNodeMap} with an `lmpr`-style roughness lane, `roughnessAt(hx, hy)` sampled per node. */
export function roughNodeMap(
  width: number,
  height: number,
  roughnessAt: (hx: number, hy: number) => number,
): TerrainMap {
  const roughness = new Array<number>(width * height);
  for (let hy = 0; hy < height; hy++) {
    for (let hx = 0; hx < width; hx++) roughness[hy * width + hx] = roughnessAt(hx, hy);
  }
  return { ...grassNodeMap(width, height), roughness };
}
