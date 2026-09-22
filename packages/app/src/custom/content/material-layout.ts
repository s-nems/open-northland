import type { GfxPattern, GfxPatternTransition } from '@open-northland/data';
import { type GroundPattern, type TransitionPattern, texturePageKey } from '@open-northland/render';
import type { CustomTerrainMaterial } from './materials.js';
import { customMountainPattern } from './mountain-layout.js';

export const MATERIAL_TILE = 128;
export const MATERIAL_GUTTER = 8;
export const MATERIAL_STRIDE = MATERIAL_TILE + MATERIAL_GUTTER * 2;
export const MATERIAL_COLUMNS = 8;
export const MATERIAL_TILES = 28;

// Pair order follows owned mask corner coverage; the interpolated edge profile is our own artwork.
export const TRANSITION_CORNERS = {
  a: [
    [1, 0, 1],
    [1, 1, 0],
    [0, 1, 1],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ],
  b: [
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
  ],
} as const;

export function materialTileCoords(tile: number, lane: 'a' | 'b'): number[] {
  const x = (tile % MATERIAL_COLUMNS) * MATERIAL_STRIDE + MATERIAL_GUTTER;
  const y = Math.floor(tile / MATERIAL_COLUMNS) * MATERIAL_STRIDE + MATERIAL_GUTTER;
  return lane === 'a'
    ? [x, y, x + MATERIAL_TILE, y + MATERIAL_TILE, x, y + MATERIAL_TILE]
    : [x, y, x + MATERIAL_TILE, y, x + MATERIAL_TILE, y + MATERIAL_TILE];
}

function groundCoords(coords: readonly number[], tile: number): number[] | undefined {
  if (coords.length !== 6 || !coords.every(Number.isFinite)) return undefined;
  const xs = coords.filter((_, i) => i % 2 === 0);
  const ys = coords.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width !== 63 || height !== 63) return undefined;
  const originX = (tile % MATERIAL_COLUMNS) * MATERIAL_STRIDE + MATERIAL_GUTTER;
  const originY = Math.floor(tile / MATERIAL_COLUMNS) * MATERIAL_STRIDE + MATERIAL_GUTTER;
  return coords.map((value, i) =>
    i % 2 === 0
      ? originX + ((value - x) / width) * MATERIAL_TILE
      : originY + ((value - y) / height) * MATERIAL_TILE,
  );
}

export function customMaterialBindings(
  patterns: readonly GfxPattern[],
  transitions: readonly GfxPatternTransition[],
  materials: readonly CustomTerrainMaterial[],
): { ground: ReadonlyMap<string, GroundPattern>; transitions: ReadonlyMap<string, TransitionPattern> } {
  const ground = new Map<string, GroundPattern>();
  const overlays = new Map<string, TransitionPattern>();
  for (const material of materials) {
    const pageKey = `own-${material.id}`;
    for (const row of patterns) {
      if (!row.editName || !row.texture || !row.coordsA || !row.coordsB) continue;
      if (!material.names.includes(row.editName) && !material.pages.includes(texturePageKey(row.texture)))
        continue;
      if (material.layout === 'mountain') {
        const binding = customMountainPattern(row, pageKey);
        if (binding) ground.set(row.editName, binding);
        continue;
      }
      const coordsA = groundCoords(row.coordsA, row.id % 4);
      const coordsB = groundCoords(row.coordsB, row.id % 4);
      if (!coordsA || !coordsB) continue;
      if (ground.has(row.editName)) throw new Error(`Duplicate custom terrain binding: ${row.editName}`);
      ground.set(row.editName, { pageKey, coordsA, coordsB });
    }
    for (const row of transitions) {
      if (!row.editName || !material.transitions.includes(row.editName)) continue;
      if (row.coordsA.length !== 6 || row.coordsB.length !== 6) continue;
      if (overlays.has(row.editName)) throw new Error(`Duplicate own transition binding: ${row.editName}`);
      const variant = /2(?:[a-d])?$/.test(row.editName) ? 1 : 0;
      overlays.set(row.editName, {
        pageKey,
        coordsA: Array.from({ length: 6 }, (_, pair) => materialTileCoords(4 + variant * 12 + pair, 'a')),
        coordsB: Array.from({ length: 6 }, (_, pair) => materialTileCoords(10 + variant * 12 + pair, 'b')),
      });
    }
  }
  return { ground, transitions: overlays };
}
