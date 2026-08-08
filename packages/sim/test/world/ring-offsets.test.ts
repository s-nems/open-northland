import { describe, expect, it } from 'vitest';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../src/systems/index.js';

/** The shared Manhattan-ring offsets: exactly the ring, each offset once, in the pinned ascending
 *  `(dy, dx)` order - ascending node id on the row-major grid. */
describe('ring offsets', () => {
  it('radius 0 is the single origin offset', () => {
    expect(walk(0)).toEqual([[0, 0]]);
  });

  it.each([1, 2, 5])('radius %i yields each |dx|+|dy|=r offset exactly once', (r) => {
    const seen = walk(r);
    for (const [dx, dy] of seen) expect(Math.abs(dx) + Math.abs(dy)).toBe(r);
    // A Manhattan ring of radius r > 0 has 4r nodes; uniqueness makes the count a full cover.
    expect(new Set(seen.map(([dx, dy]) => `${dx},${dy}`)).size).toBe(4 * r);
    expect(seen.length).toBe(4 * r);
  });

  it('visits in ascending (dy, dx) - ascending node id on a row-major grid', () => {
    const seen = walk(3);
    const sorted = [...seen].sort(([adx, ady], [bdx, bdy]) => ady - bdy || adx - bdx);
    expect(seen).toEqual(sorted);
  });

  it.each([0, 1, 2, 3, 7])('index arithmetic addresses the radius-%i diamond row by row', (r) => {
    expect(walk(r)).toEqual(rowWalk(r));
    // A negated zero keys a node the same but reads back as -0 in a diagnostic.
    for (const [dx, dy] of walk(r)) expect([Object.is(dx, -0), Object.is(dy, -0)]).toEqual([false, false]);
  });
});

function walk(radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ringOffsetCount(radius); i++)
    out.push([ringOffsetDx(radius, i), ringOffsetDy(radius, i)]);
  return out;
}

/** The ring as its geometry states it, independent of the index arithmetic under test: for each `dy`, the
 *  one or two columns `dx = ±(radius - |dy|)`. */
function rowWalk(radius: number): [number, number][] {
  if (radius === 0) return [[0, 0]];
  const out: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const dxMag = radius - Math.abs(dy);
    if (dxMag === 0) out.push([0, dy]);
    else out.push([-dxMag, dy], [dxMag, dy]);
  }
  return out;
}
