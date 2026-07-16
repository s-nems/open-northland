import { describe, expect, it } from 'vitest';
import type { SceneGround } from '../src/data/scene/index.js';
import { cellNode } from '../src/data/terrain.js';
import { makeWaveField, NO_WAVE } from '../src/data/water.js';

/** A width×height ground layer where `waterCells` (row-major indices) draw a water pattern on both
 *  triangles and everything else draws grass. */
function groundOf(width: number, height: number, waterCells: ReadonlySet<number>): SceneGround {
  const cells = width * height;
  const a = new Array<number>(cells);
  const b = new Array<number>(cells);
  for (let i = 0; i < cells; i++) {
    const p = waterCells.has(i) ? 1 : 0;
    a[i] = p;
    b[i] = p;
  }
  return { patterns: ['block meadow 00', 'block water 01'], a, b };
}

describe('makeWaveField', () => {
  it('returns the shared still field without ground lanes or without any water pattern', () => {
    expect(makeWaveField(undefined, 4, 4)).toBe(NO_WAVE);
    expect(makeWaveField(groundOf(4, 4, new Set()), 4, 4)).toBe(NO_WAVE);
  });

  it('is 1 deep inside water and 0 on any node a land triangle can reach', () => {
    // A 7×7 grid whose central 5×5 is water: only the very centre cell has a full 3×3 water
    // neighbourhood, so only its centre node carries full amplitude.
    const water = new Set<number>();
    for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) water.add(r * 7 + c);
    const wave = makeWaveField(groundOf(7, 7, water), 7, 7);
    const centre = cellNode(3, 3);
    expect(wave(centre[0], centre[1])).toBe(1);
    // A cell one ring out from the centre touches land in its 3×3 neighbourhood → still.
    const ring = cellNode(1, 1);
    expect(wave(ring[0], ring[1])).toBe(0);
    // Land node far from water: still.
    const land = cellNode(0, 6);
    expect(wave(land[0], land[1])).toBe(0);
  });
});
