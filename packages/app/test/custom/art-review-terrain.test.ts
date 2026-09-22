import { describe, expect, it } from 'vitest';
import { reviewTerrain } from '../../src/custom/art-review/terrain.js';

describe('art review terrain joins', () => {
  it('assigns identical material and periodic texture coordinates to shared lattice vertices', () => {
    const terrain = reviewTerrain(18, 20);
    const ground = terrain.ground;
    expect(ground).toBeDefined();
    if (!ground) return;
    const vertices = new Map<string, { soil: number; u: number; v: number }>();
    let shared = 0;
    for (let row = 0; row < terrain.height; row++) {
      for (let col = 0; col < terrain.width; col++) {
        const pattern = ground.a[row * terrain.width + col];
        expect(pattern).toBe(ground.b[row * terrain.width + col]);
        if (pattern === undefined) throw new Error('Missing ground pattern');
        const phase = Math.floor(pattern / 16);
        const originY = Math.floor(phase / 4);
        const originX = (phase % 4) + (originY & 1) * 0.5;
        for (const [corner, [dx, dy]] of [
          [0, 0],
          [2, 0],
          [1, 2],
          [-1, 2],
        ].entries()) {
          if (dx === undefined || dy === undefined) throw new Error('Missing vertex');
          const key = `${2 * col + (row & 1) + dx},${2 * row + dy}`;
          const value = {
            soil: (pattern >> corner) & 1,
            u: (((originX + dx / 2) % 4) + 4) % 4,
            v: (originY + dy / 2) % 4,
          };
          const previous = vertices.get(key);
          if (previous) {
            expect(value).toEqual(previous);
            shared++;
          } else vertices.set(key, value);
        }
      }
    }
    expect(shared).toBeGreaterThan(900);
    expect(new Set([...vertices.values()].map((vertex) => vertex.soil))).toEqual(new Set([0, 1]));
  });
});
