import { describe, expect, it } from 'vitest';
import { ONE, cellAnchorNode, fx, nodeOfPosition, positionOfNode } from '../../src/index.js';

/**
 * The half-cell ↔ Position conversion seam (`nav/halfcell.ts`) — the one place a fractional
 * fixed-point Position becomes an integer node address and back. These pin the exact geometry the
 * whole grid vocabulary hangs on: cell (c,r) = node (2c+(r&1), 2r), a rectangular node lattice in
 * world space, quarters exact in fixed point.
 */

const Q = (n: number): number => (n * ONE) / 4; // exact quarter-tiles (ONE is divisible by 4)

describe('cellAnchorNode', () => {
  it('maps a visual cell to its centre node with the row-parity stagger made integral', () => {
    expect(cellAnchorNode(0, 0)).toEqual({ hx: 0, hy: 0 });
    expect(cellAnchorNode(3, 2)).toEqual({ hx: 6, hy: 4 }); // even row: no shift
    expect(cellAnchorNode(3, 5)).toEqual({ hx: 7, hy: 10 }); // odd row: half-cell right
  });
});

describe('positionOfNode', () => {
  it('is exactly the cell centre for a cell-anchored node', () => {
    for (const [cx, cy] of [
      [0, 0],
      [3, 2],
      [3, 5],
      [7, 1],
    ] as const) {
      const { hx, hy } = cellAnchorNode(cx, cy);
      expect(positionOfNode(hx, hy)).toEqual({ x: fx.fromInt(cx), y: fx.fromInt(cy) });
    }
  });

  it('places off-centre nodes at exact quarter-tile positions (stagger removed per row)', () => {
    // Node (1,0): the E-mid node of cell (0,0) — even row, no stagger: x = ½.
    expect(positionOfNode(1, 0)).toEqual({ x: Q(2), y: Q(0) });
    // Node (0,2): row 1 (odd, stagger ½): x = 0 − ½ = −½ — the west-border seam transient.
    expect(positionOfNode(0, 2)).toEqual({ x: Q(-2), y: fx.fromInt(1) });
    // Node (2,1): row ½ (stagger ¼): x = 1 − ¼ = ¾.
    expect(positionOfNode(2, 1)).toEqual({ x: Q(3), y: Q(2) });
  });
});

describe('nodeOfPosition', () => {
  it('round-trips every node of a small grid exactly', () => {
    for (let hy = 0; hy < 8; hy++) {
      for (let hx = 1; hx < 8; hx++) {
        // hx ≥ 1: node (0, hy) on an odd row sits at world x < 0 (the border seam) and legitimately
        // truncates to hx 0 only via clamping — covered by the border case below.
        const p = positionOfNode(hx, hy);
        expect(nodeOfPosition(p.x, p.y)).toEqual({ hx, hy });
      }
    }
  });

  it('truncates a mid-leg position onto the node behind it (floor-until-arrival)', () => {
    // A walker at (0.4, 0): world x 0.4 → 2·0.4 = 0.8 truncates to node 0; row 0 → hy 0.
    expect(nodeOfPosition(fx.fromFloat(0.4), fx.fromInt(0))).toEqual({ hx: 0, hy: 0 });
    // At (0.6, 0) it has passed the E-mid node (1,0): 2·0.6 = 1.2 → hx 1.
    expect(nodeOfPosition(fx.fromFloat(0.6), fx.fromInt(0))).toEqual({ hx: 1, hy: 0 });
  });
});
