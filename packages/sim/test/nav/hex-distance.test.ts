import { describe, expect, it } from 'vitest';
import {
  forEachRingNode,
  hexDistance,
  hexDistanceBetween,
  hexNeighboursOf,
  latticeDistanceBounds,
  rowReachLeft,
  rowReachRight,
} from '../../src/nav/halfcell.js';
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

describe('the ring walk over a bounded lattice', () => {
  const WIDTH = 9;
  const HEIGHT = 7;
  /** Inside, on both row parities, on an edge and far off every side. */
  const CENTRES = [
    { hx: 4, hy: 3 },
    { hx: 4, hy: 4 },
    { hx: 0, hy: 0 },
    { hx: -5, hy: 2 },
    { hx: 20, hy: -9 },
    { hx: 3, hy: 15 },
  ];

  function nodesAt(centre: { hx: number; hy: number }, radius: number): string[] {
    const out: string[] = [];
    for (let hy = 0; hy < HEIGHT; hy++)
      for (let hx = 0; hx < WIDTH; hx++)
        if (hexDistanceBetween(hx, hy, centre.hx, centre.hy) === radius) out.push(`${hx},${hy}`);
    return out;
  }

  it('inverts the distance per row: a row reaches exactly the columns within range', () => {
    for (const centre of [...CENTRES, { hx: -3, hy: -3 }]) {
      for (let range = 0; range <= 6; range++) {
        for (let hy = centre.hy - range; hy <= centre.hy + range; hy++) {
          const within: number[] = [];
          for (let hx = centre.hx - 2 * range - 2; hx <= centre.hx + 2 * range + 2; hx++)
            if (hexDistanceBetween(hx, hy, centre.hx, centre.hy) <= range) within.push(hx);
          expect([rowReachLeft(centre, hy, range), rowReachRight(centre, hy, range)]).toEqual([
            within[0],
            within.at(-1),
          ]);
          expect(within).toHaveLength(rowReachRight(centre, hy, range) - rowReachLeft(centre, hy, range) + 1);
        }
      }
    }
  });

  it('bounds the distances the lattice holds by its clamped centre and its corners', () => {
    for (const centre of CENTRES) {
      const all: number[] = [];
      for (let hy = 0; hy < HEIGHT; hy++)
        for (let hx = 0; hx < WIDTH; hx++) all.push(hexDistanceBetween(hx, hy, centre.hx, centre.hy));
      expect(latticeDistanceBounds(centre, WIDTH, HEIGHT)).toEqual({
        nearest: Math.min(...all),
        farthest: Math.max(...all),
      });
    }
  });

  it('visits every node of a ring once, row-major, and stops when told', () => {
    for (const centre of CENTRES) {
      const { nearest, farthest } = latticeDistanceBounds(centre, WIDTH, HEIGHT);
      for (let radius = nearest; radius <= farthest; radius++) {
        const walked: string[] = [];
        const finished = forEachRingNode(centre, radius, WIDTH, HEIGHT, (hx, hy) => {
          walked.push(`${hx},${hy}`);
          return true;
        });
        expect(finished).toBe(true);
        expect(walked).toEqual(nodesAt(centre, radius));
      }
    }
    let visits = 0;
    expect(forEachRingNode({ hx: 4, hy: 3 }, 2, WIDTH, HEIGHT, () => ++visits < 3)).toBe(false);
    expect(visits).toBe(3);
  });
});
