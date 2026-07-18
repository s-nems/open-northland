import { describe, expect, it } from 'vitest';
import { forEachRingOffset } from '../../src/systems/index.js';

/** The shared Manhattan-ring enumerator (footprint/geometry.ts): exactly the ring, each offset once,
 *  in the pinned ascending `(dy, dx)` order — ascending node id on the row-major grid. */
describe('forEachRingOffset', () => {
  it('radius 0 is the single origin offset', () => {
    const seen: [number, number][] = [];
    forEachRingOffset(0, (dx, dy) => seen.push([dx, dy]));
    expect(seen).toEqual([[0, 0]]);
  });

  it.each([1, 2, 5])('radius %i yields each |dx|+|dy|=r offset exactly once', (r) => {
    const seen: [number, number][] = [];
    forEachRingOffset(r, (dx, dy) => seen.push([dx, dy]));
    for (const [dx, dy] of seen) expect(Math.abs(dx) + Math.abs(dy)).toBe(r);
    // A Manhattan ring of radius r > 0 has 4r nodes; uniqueness makes the count a full cover.
    expect(new Set(seen.map(([dx, dy]) => `${dx},${dy}`)).size).toBe(4 * r);
    expect(seen.length).toBe(4 * r);
  });

  it('visits in ascending (dy, dx) — ascending node id on a row-major grid', () => {
    const seen: [number, number][] = [];
    forEachRingOffset(3, (dx, dy) => seen.push([dx, dy]));
    const sorted = [...seen].sort(([adx, ady], [bdx, bdy]) => ady - bdy || adx - bdx);
    expect(seen).toEqual(sorted);
  });
});
