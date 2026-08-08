import { FNV_OFFSET_BASIS, fnvHex, fnvMixWord } from './fnv.js';

/** The grid shape shared by the sim's half-cell `TerrainMap` and any cell-resolution source. */
export interface TerrainGrid {
  readonly width: number;
  readonly height: number;
  readonly typeIds: ArrayLike<number>;
}

/**
 * FNV-1a 32-bit over `(width, height, typeIds)`, as 8 hex digits: the identity of the exact grid the
 * sim navigates. Render lanes and authored placements stay out; they do not shape navigation.
 */
export function terrainGridFingerprint(grid: TerrainGrid): string {
  let h = FNV_OFFSET_BASIS;
  h = fnvMixWord(h, grid.width);
  h = fnvMixWord(h, grid.height);
  for (let i = 0; i < grid.typeIds.length; i++) {
    const typeId = grid.typeIds[i];
    if (typeId === undefined) throw new Error(`terrain grid has a hole at index ${i}`);
    h = fnvMixWord(h, typeId);
  }
  return fnvHex(h);
}
