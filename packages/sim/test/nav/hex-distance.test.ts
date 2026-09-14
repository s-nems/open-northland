import { describe, expect, it } from 'vitest';
import { hexDistance, hexDistanceBetween, hexNeighboursOf } from '../../src/nav/halfcell.js';
import { hexNodeBox } from '../../src/nav/node-circle.js';

/**
 * The map-point distance every script `range` is measured in. The lattice staggers: rows lean half a
 * column against each other, so the six nodes around a point are its two column neighbours, the two
 * rows above and below in its own column, and the two the row leans towards.
 */
describe('the half-cell map-point distance', () => {
  it('is zero to itself and one to each of the six neighbours', () => {
    const from = { hx: 4, hy: 4 };
    expect(hexDistance(from, from)).toBe(0);
    const neighbours = [
      { hx: 5, hy: 4 },
      { hx: 3, hy: 4 },
      { hx: 4, hy: 3 },
      { hx: 4, hy: 5 },
      { hx: 3, hy: 3 }, // an even row leans left
      { hx: 3, hy: 5 },
    ];
    for (const to of neighbours)
      expect(`${to.hx},${to.hy}: ${hexDistance(from, to)}`).toBe(`${to.hx},${to.hy}: 1`);
    // The node the row leans away from costs two steps.
    expect(hexDistance(from, { hx: 5, hy: 5 })).toBe(2);
  });

  it('leans the other way from an odd row', () => {
    const from = { hx: 4, hy: 5 };
    expect(hexDistance(from, { hx: 5, hy: 6 })).toBe(1);
    expect(hexDistance(from, { hx: 3, hy: 6 })).toBe(2);
  });

  it('is symmetric, and a diagonal walk covers one column per two rows for free', () => {
    const a = { hx: 4, hy: 4 };
    const b = { hx: 9, hy: 14 };
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
    // Ten rows carry five columns; the run costs the rows alone.
    expect(hexDistance(a, b)).toBe(10);
    // One column past what the rows carry costs one more step.
    expect(hexDistance(a, { hx: 10, hy: 14 })).toBe(11);
  });

  it('reads one to each lattice neighbour of hexNeighboursOf, from either row parity', () => {
    for (const [hx, hy] of [
      [10, 10],
      [10, 11],
    ] as const) {
      expect(hexDistanceBetween(hx, hy, hx, hy)).toBe(0);
      for (const n of hexNeighboursOf(hx, hy)) {
        expect(hexDistanceBetween(hx, hy, n.hx, n.hy), `(${hx},${hy})->(${n.hx},${n.hy})`).toBe(1);
        expect(hexDistanceBetween(n.hx, n.hy, hx, hy)).toBe(1);
      }
    }
  });

  it('counts columns straight across and rows straight down, at guidepost ranges', () => {
    expect(hexDistanceBetween(0, 0, 50, 0)).toBe(50);
    expect(hexDistanceBetween(0, 0, 0, 50)).toBe(50);
    expect(hexDistanceBetween(0, 0, 0, 51)).toBe(51);
    // Twenty rows down carry ten columns for free; the eleventh costs one.
    expect(hexDistanceBetween(0, 0, 10, 20)).toBe(20);
    expect(hexDistanceBetween(0, 0, 11, 20)).toBe(21);
    expect(hexDistanceBetween(0, 0, -10, 20)).toBe(20);
  });
});

describe('hexNodeBox', () => {
  it('spans the range in columns and rows each way', () => {
    expect(hexNodeBox(10, 20, 5)).toEqual({ minX: 5, maxX: 15, minY: 15, maxY: 25 });
  });
});
