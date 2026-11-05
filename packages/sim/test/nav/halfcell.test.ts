import { describe, expect, it } from 'vitest';
import type { Fixed } from '../../src/core/fixed.js';
import {
  cellAnchorNode,
  cellOfAnchorNode,
  cellOfNode,
  fx,
  type HalfCellNode,
  hexNeighboursOf,
  nodeOfPosition,
  ONE,
  positionOfNode,
} from '../../src/index.js';
import { insideNodeCore, nodeWorldX, positionXOfWorld, positionYOfNode } from '../../src/nav/halfcell.js';
import { ROW_STEP } from '../../src/nav/world-metric.js';

/**
 * The half-cell ↔ Position conversion seam (`nav/halfcell.ts`) - the one place a fractional
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

describe('cellOfAnchorNode', () => {
  it('inverts cellAnchorNode for both row parities', () => {
    expect(cellOfAnchorNode(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(cellOfAnchorNode(6, 4)).toEqual({ cx: 3, cy: 2 });
    expect(cellOfAnchorNode(7, 10)).toEqual({ cx: 3, cy: 5 }); // odd row: parity undone
  });

  it('round-trips every cell in a block spanning both parities', () => {
    for (let cy = 0; cy < 8; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        const { hx, hy } = cellAnchorNode(cx, cy);
        expect(cellOfAnchorNode(hx, hy)).toEqual({ cx, cy });
      }
    }
  });
});

describe('cellOfNode', () => {
  it('agrees with cellOfAnchorNode on every centre node', () => {
    for (let cy = 0; cy < 8; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        const { hx, hy } = cellAnchorNode(cx, cy);
        expect(cellOfNode(hx, hy)).toEqual({ cx, cy });
      }
    }
  });

  it('settles a between-row node the original`s way: right below an even cell row, straight below an odd one', () => {
    // hy % 4 == 1: the row under an even cell row nudges one node right before halving.
    expect(cellOfNode(3, 1)).toEqual({ cx: 2, cy: 0 });
    expect(cellOfNode(2, 1)).toEqual({ cx: 1, cy: 0 });
    // hy % 4 == 3: the row under an odd cell row halves as is.
    expect(cellOfNode(2, 3)).toEqual({ cx: 1, cy: 1 });
    expect(cellOfNode(3, 3)).toEqual({ cx: 1, cy: 1 });
    // hy % 4 == 2: an odd cell row's own anchor row nudges one left, so its off-centre node stays in the row's cell.
    expect(cellOfNode(4, 2)).toEqual({ cx: 1, cy: 1 });
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
    // Node (1,0): the E-mid node of cell (0,0) - even row, no stagger: x = ½.
    expect(positionOfNode(1, 0)).toEqual({ x: Q(2), y: Q(0) });
    // Node (0,2): row 1 (odd, stagger ½): x = 0 − ½ = −½ - the west-border seam transient.
    expect(positionOfNode(0, 2)).toEqual({ x: Q(-2), y: fx.fromInt(1) });
    // Node (2,1): an odd row, world 1 + ¼; row ½ (stagger ¼): x = 1¼ − ¼ = 1.
    expect(positionOfNode(2, 1)).toEqual({ x: Q(4), y: Q(2) });
  });
});

describe('nodeOfPosition', () => {
  // Screen-proportional world metric in floats: x in columns, y rows scaled by ROW_STEP.
  const ROW = fx.toFloat(ROW_STEP);
  const TOLERANCE = 1 / 16; // the column-line strip half-width
  const MARGIN = 1e-3; // keeps samples off a rule's boundary, where fixed-point rounding may fall either way
  const nodeWx = (n: HalfCellNode): number => fx.toFloat(nodeWorldX(n.hx, n.hy));
  const nodeWy = (n: HalfCellNode): number => (n.hy / 2) * ROW;
  const read = (wx: number, wy: number): HalfCellNode => {
    const y = fx.fromFloat(wy / ROW);
    return nodeOfPosition(positionXOfWorld(fx.fromFloat(wx), y), y);
  };
  const ORIGINS: readonly HalfCellNode[] = [
    { hx: 6, hy: 4 },
    { hx: 6, hy: 5 },
    { hx: 0, hy: 4 },
    { hx: 0, hy: 5 },
    { hx: -3, hy: -2 },
    { hx: -3, hy: -3 },
  ];
  const OFFSETS = [-0.05, -0.02, -0.005, 0, 0.005, 0.02, 0.05];
  const PROGRESS = Array.from({ length: 49 }, (_, i) => (i + 1) / 50).filter(
    (t) => Math.abs(t - 0.5) > 0.015,
  );

  it('reads every node centre as itself, negative coordinates included', () => {
    for (let hy = -4; hy < 8; hy++) {
      for (let hx = -4; hx < 8; hx++) {
        const p = positionOfNode(hx, hy);
        expect(nodeOfPosition(p.x, p.y)).toEqual({ hx, hy });
      }
    }
  });

  it('reads each of the six edges as its start before half progress and its end after, off the line too', () => {
    for (const from of ORIGINS) {
      for (const to of hexNeighboursOf(from.hx, from.hy)) {
        const dx = nodeWx(to) - nodeWx(from);
        const dy = nodeWy(to) - nodeWy(from);
        const length = Math.hypot(dx, dy);
        for (const offset of OFFSETS) {
          for (const t of PROGRESS) {
            // An E/W edge's midpoint lies on a column step's line across its row: nearer that line than the
            // row, the position is the column step's.
            if (dy === 0 && Math.abs(t - 0.5) * Math.abs(dx) <= Math.abs(offset) + MARGIN) continue;
            const wx = nodeWx(from) + dx * t - (dy / length) * offset;
            const wy = nodeWy(from) + dy * t + (dx / length) * offset;
            expect(
              read(wx, wy),
              `${from.hx},${from.hy} to ${to.hx},${to.hy} t ${t} offset ${offset}`,
            ).toEqual(t < 0.5 ? from : to);
          }
        }
      }
    }
  });

  it('reads a column step as its start, then its end, never a node of the row it skips', () => {
    for (const from of ORIGINS) {
      for (const rows of [-2, 2]) {
        const to = { hx: from.hx, hy: from.hy + rows };
        const dy = nodeWy(to) - nodeWy(from);
        for (const offset of OFFSETS) {
          for (const t of PROGRESS) {
            // Nearer its skipped row than its line, a position is an E/W walker's off its row.
            if (Math.abs(t - 0.5) * Math.abs(dy) <= Math.abs(offset) + MARGIN) continue;
            const got = read(nodeWx(from) + offset, nodeWy(from) + dy * t);
            expect(got, `${from.hx},${from.hy} to ${to.hx},${to.hy} t ${t} offset ${offset}`).toEqual(
              t < 0.5 ? from : to,
            );
          }
        }
      }
    }
  });

  it('settles the half-progress ties west on a row and north between rows', () => {
    const at = (wx: Fixed, y: Fixed): HalfCellNode => nodeOfPosition(positionXOfWorld(wx, y), y);
    const half = (a: Fixed, b: Fixed): Fixed => fx.div(fx.add(a, b), fx.fromInt(2));
    const row5 = positionOfNode(6, 5).y;
    expect(at(half(nodeWorldX(6, 5), nodeWorldX(7, 5)), row5)).toEqual({ hx: 6, hy: 5 });
    // The column step (7, 4) -> (7, 6) exactly on its skipped row is that E/W edge's midpoint.
    expect(at(nodeWorldX(7, 4), row5)).toEqual({ hx: 6, hy: 5 });
    // The slant edge (6, 4) -> (6, 5) at its exact midpoint.
    expect(at(half(nodeWorldX(6, 4), nodeWorldX(6, 5)), half(positionOfNode(6, 4).y, row5))).toEqual({
      hx: 6,
      hy: 4,
    });
  });

  /** The rule's reference in floats: the column-line strip, else the nearest node of the bracketing rows;
   *  undefined within {@link MARGIN} of a boundary. */
  const expectedRead = (wx: number, wy: number): HalfCellNode | undefined => {
    const north = Math.floor(wy / (ROW / 2));
    const rows = [north, north + 1];
    const nearestIn = (hy: number): HalfCellNode => {
      const shift = (hy & 1) === 0 ? 0 : 0.25;
      return { hx: Math.round((wx - shift) * 2) | 0, hy }; // `| 0`: +0, as the sim reads
    };
    const [n, s] = rows.map(nearestIn) as [HalfCellNode, HalfCellNode];
    const dx = (node: HalfCellNode): number => Math.abs(wx - nodeWx(node));
    const dy = (node: HalfCellNode): number => Math.abs(wy - nodeWy(node));
    for (const [line, other] of [
      [n, s],
      [s, n],
    ] as const) {
      const inside = Math.min(TOLERANCE - dx(line), dy(other) - dx(line));
      if (Math.abs(inside) < MARGIN) return undefined;
      if (inside > 0) return line;
    }
    const dn = Math.hypot(dx(n), dy(n));
    const ds = Math.hypot(dx(s), dy(s));
    if (Math.abs(dn - ds) < MARGIN) return undefined;
    // The nearest node anywhere lies in a bracketing row; check against the rows beyond them too.
    const best = dn < ds ? n : s;
    for (const hy of [north - 1, north + 2]) {
      const far = nearestIn(hy);
      expect(Math.hypot(dx(far), dy(far))).toBeGreaterThan(Math.min(dn, ds));
    }
    return best;
  };

  it('reads any other position as the nearest node by screen distance', () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let checked = 0;
    for (let i = 0; i < 20000; i++) {
      const wx = -4 + next() * 12;
      const wy = (-4 + next() * 12) * ROW;
      const expected = expectedRead(wx, wy);
      if (expected === undefined) continue;
      checked++;
      expect(read(wx, wy), `world ${wx}, ${wy}`).toEqual(expected);
    }
    expect(checked).toBeGreaterThan(19000);
  });

  it('keeps a body pushed sideways off a node on it, whatever an ulp of vertical offset', () => {
    const SEPARATION_RADIUS = 0.26;
    const DIRECTIONS = 32;
    for (const origin of ORIGINS) {
      const centre = positionOfNode(origin.hx, origin.hy);
      for (let d = 0; d < DIRECTIONS; d++) {
        const angle = (2 * Math.PI * d) / DIRECTIONS;
        for (let r = 0.01; r <= SEPARATION_RADIUS; r += 0.01) {
          const wx = nodeWx(origin) + Math.cos(angle) * r;
          const wy = nodeWy(origin) + Math.sin(angle) * r;
          if (expectedRead(wx, wy)?.hx !== origin.hx || expectedRead(wx, wy)?.hy !== origin.hy) continue;
          expect(read(wx, wy), `${origin.hx},${origin.hy} angle ${d} r ${r}`).toEqual(origin);
        }
      }
      // Pushed straight east, the reviewer's flicker: a 1-ulp vertical offset either way reads the node.
      for (let px = 1; px <= 16.5; px += 0.5) {
        const wx = fx.add(nodeWorldX(origin.hx, origin.hy), fx.fromFloat(px / 68));
        for (const ulps of [-1, 0, 1]) {
          const y = fx.add(centre.y, ulps as Fixed);
          expect(nodeOfPosition(positionXOfWorld(wx, y), y), `${px} px, ${ulps} ulp`).toEqual(origin);
        }
      }
    }
  });

  it('floors a row above the map, so an off-map transient reads row -1', () => {
    const y = fx.fromFloat(-0.1);
    expect(nodeOfPosition(positionXOfWorld(nodeWorldX(4, -1), y), y).hy).toBe(-1);
  });
});

describe('insideNodeCore', () => {
  /** Nodes of both row parities, the map's corner and an off-map transient. */
  const NODES: readonly HalfCellNode[] = [
    { hx: 0, hy: 0 },
    { hx: 7, hy: 3 },
    { hx: 12, hy: 6 },
    { hx: -3, hy: -5 },
  ];
  /** Raw world-column and row offsets swept around a node: past the core's reach, an odd stride so the
   *  sweep lands on unaligned positions. */
  const REACH = fx.div(ONE, fx.fromInt(4));
  const STRIDE = 97;

  it('holds only positions that read the node', () => {
    for (const node of NODES) {
      const centreWx = nodeWorldX(node.hx, node.hy);
      const centreY = positionYOfNode(node.hy);
      let inside = 0;
      for (let dy = -2 * REACH; dy <= 2 * REACH; dy += STRIDE) {
        for (let dwx = -REACH; dwx <= REACH; dwx += STRIDE) {
          const y = fx.add(centreY, dy as Fixed);
          const x = positionXOfWorld(fx.add(centreWx, dwx as Fixed), y);
          if (!insideNodeCore(x, y, node.hx, node.hy)) continue;
          inside++;
          expect(nodeOfPosition(x, y)).toEqual(node);
        }
      }
      expect(inside).toBeGreaterThan(0);
    }
  });

  it('holds the centre and a position a fifth of a column east of it, not one past a neighbour', () => {
    const at = positionOfNode(7, 3);
    expect(insideNodeCore(at.x, at.y, 7, 3)).toBe(true);
    const fifth = positionXOfWorld(fx.add(nodeWorldX(7, 3), fx.div(ONE, fx.fromInt(6))), at.y);
    expect(insideNodeCore(fifth, at.y, 7, 3)).toBe(true);
    const east = positionOfNode(8, 3);
    expect(insideNodeCore(east.x, east.y, 7, 3)).toBe(false);
  });
});
