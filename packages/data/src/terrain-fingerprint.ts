/** The grid shape shared by the sim's half-cell `TerrainMap` and any cell-resolution source. */
export interface TerrainGrid {
  readonly width: number;
  readonly height: number;
  readonly typeIds: ArrayLike<number>;
}

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * FNV-1a 32-bit over `(width, height, typeIds)`, as 8 hex digits: the identity of the exact grid the
 * sim navigates. Render lanes and authored placements stay out; they do not shape navigation, and
 * their effects on state are covered by content identity plus the saved entities themselves.
 */
export function terrainGridFingerprint(grid: TerrainGrid): string {
  let h = FNV_OFFSET_BASIS >>> 0;
  const mix = (value: number): void => {
    h = Math.imul(h ^ (value >>> 0), FNV_PRIME) >>> 0;
  };
  mix(grid.width);
  mix(grid.height);
  for (let i = 0; i < grid.typeIds.length; i++) {
    const typeId = grid.typeIds[i];
    if (typeId === undefined) throw new Error(`terrain grid has a hole at index ${i}`);
    mix(typeId);
  }
  return h.toString(16).padStart(8, '0');
}
