import { halfCellMapFromCells, type TerrainMap } from '../../../src/index.js';

/**
 * Unit tests for the terrain HALF-CELL ADJACENCY GRAPH (the sim's navigation model). The fixture's
 * landscape table has typeId 0 = grass (walkable) and 1 = water (not walkable); these tests pin the
 * deterministic addressing, neighbour order, the half-cell upsampling, and the 8-direction edge set
 * the pathfinder depends on.
 */

export const GRASS = 0;
export const WATER = 1;

/** A 3×3-CELL map with a water cell in the centre and grass elsewhere, upsampled to its 6×6 nodes. */
export function crossMap(): TerrainMap {
  return halfCellMapFromCells({
    width: 3,
    height: 3,
    typeIds: [GRASS, GRASS, GRASS, GRASS, WATER, GRASS, GRASS, GRASS, GRASS],
  });
}

/** A raw half-cell grid, all grass except the listed water nodes — for node-granular fixtures the
 *  2×2-block upsampler cannot express. */
export function rawGrid(
  width: number,
  height: number,
  water: ReadonlyArray<readonly [number, number]> = [],
): TerrainMap {
  const typeIds = new Array(width * height).fill(GRASS);
  for (const [x, y] of water) typeIds[y * width + x] = WATER;
  return { resolution: 'half-cell', width, height, typeIds };
}
