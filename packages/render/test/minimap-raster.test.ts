import { describe, expect, it } from 'vitest';
import { TILE_HALF_H, TILE_HALF_W, tileToScreen } from '../src/data/projection/index.js';
import {
  averagePatternColour,
  cellColoursFromGround,
  MINIMAP_CELL_UNRESOLVED,
  terrainWorldBounds,
} from '../src/data/terrain/minimap.js';

describe('terrainWorldBounds', () => {
  it('covers every cell diamond, including the odd-row half-cell stagger', () => {
    const bounds = terrainWorldBounds(4, 4);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const center = tileToScreen(col, row);
        expect(center.x - TILE_HALF_W).toBeGreaterThanOrEqual(bounds.minX);
        expect(center.x + TILE_HALF_W).toBeLessThanOrEqual(bounds.minX + bounds.width);
        expect(center.y - TILE_HALF_H).toBeGreaterThanOrEqual(bounds.minY);
        expect(center.y + TILE_HALF_H).toBeLessThanOrEqual(bounds.minY + bounds.height);
      }
    }
  });
});

describe('minimap ground-lane colours', () => {
  it('averages a page rect skipping transparent texels', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0, 9, 9, 9, 0]);
    expect(averagePatternColour(rgba, 2, 2, { x: 0, y: 0, w: 2, h: 2 })).toBe((128 << 16) | (0 << 8) | 128);
  });

  it('returns undefined for an all-transparent or out-of-bounds rect', () => {
    const rgba = new Uint8ClampedArray([9, 9, 9, 0]);
    expect(averagePatternColour(rgba, 1, 1, { x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    expect(averagePatternColour(rgba, 1, 1, { x: 5, y: 5, w: 2, h: 2 })).toBeUndefined();
  });

  it('mixes the two triangle patterns per cell and marks unresolved cells', () => {
    const ground = { patterns: ['water', 'grass', 'missing'], a: [0, 2], b: [1, 2] };
    const colour = (index: number): number | undefined => [0x000080, 0x008000, undefined][index];
    const cells = cellColoursFromGround(ground, 2, colour);
    expect(cells[0]).toBe((0 << 16) | (0x40 << 8) | 0x40);
    expect(cells[1]).toBe(MINIMAP_CELL_UNRESOLVED);
  });

  it('falls back to the single resolved triangle when the other pattern is unknown', () => {
    const ground = { patterns: ['water', 'missing'], a: [0], b: [1] };
    const cells = cellColoursFromGround(ground, 1, (index) => (index === 0 ? 0x123456 : undefined));
    expect(cells[0]).toBe(0x123456);
  });
});
