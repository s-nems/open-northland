import { describe, expect, it } from 'vitest';
import {
  cellNode,
  nodeCell,
  nodeLaneUV,
  nodeLift,
  patternSrcRect,
  rectTriangleUVs,
  TRANSITION_NONE,
  transitionRef,
  triangleANodes,
  triangleBNodes,
  triangleUVs,
} from '../src/data/terrain/index.js';
import { halfCellToScreen, TILE_HALF_H, TILE_HALF_W, tileToScreen } from '../src/index.js';

/**
 * The PURE, self-verifiable half of textured terrain: the node-lattice tessellation + UV folds the
 * GPU mesh build consumes (source basis: the original engine's ground mesh — docs/SOURCES.md
 * "terrain tessellation"). Pixels stay human-gated, but the vertex/UV math is unit-tested here so a
 * regression in the triangle node picks / UV folds / lift rule is caught headless.
 */

describe('cellNode / nodeCell — the cell-centre lattice', () => {
  it('places even-row centres at (2c, 2r) and odd-row centres staggered half a cell right', () => {
    expect(cellNode(0, 0)).toEqual([0, 0]);
    expect(cellNode(3, 2)).toEqual([6, 4]);
    expect(cellNode(3, 5)).toEqual([7, 10]); // odd row → +1
  });

  it('nodeCell inverts cellNode for every parity', () => {
    for (const [col, row] of [
      [0, 0],
      [3, 2],
      [3, 5],
      [7, 9],
      [0, 1],
    ] as const) {
      expect(nodeCell(...cellNode(col, row))).toEqual([col, row]);
    }
  });

  it('projects a cell centre to the SAME screen point as the staggered tile raster', () => {
    for (const [col, row] of [
      [0, 0],
      [5, 4],
      [2, 7],
    ] as const) {
      const [hx, hy] = cellNode(col, row);
      expect(halfCellToScreen(hx, hy)).toEqual(tileToScreen(col, row));
    }
  });
});

describe('triangle node picks — two triangles per cell, BETWEEN cell centres', () => {
  it('△ A spans [own centre, SE-below centre, SW-below centre]', () => {
    // Even row: cell (2,2) centres at node (4,4).
    expect(triangleANodes(2, 2)).toEqual([
      [4, 4],
      [5, 6],
      [3, 6],
    ]);
    // Odd row: cell (2,3) centres at node (5,6) — the stagger shifts the below-row picks too.
    expect(triangleANodes(2, 3)).toEqual([
      [5, 6],
      [6, 8],
      [4, 8],
    ]);
  });

  it('▽ B spans [own centre, E centre, SE-below centre]', () => {
    expect(triangleBNodes(2, 2)).toEqual([
      [4, 4],
      [6, 4],
      [5, 6],
    ]);
    expect(triangleBNodes(2, 3)).toEqual([
      [5, 6],
      [7, 6],
      [6, 8],
    ]);
  });

  it('every triangle vertex IS a neighbouring cell centre (the per-cell lane join)', () => {
    // The cell-index arithmetic of the original tessellation: for cell (c, r) with s = r&1,
    // A = centres of cells [(c,r), (c+s, r+1), (c+s−1, r+1)], B = [(c,r), (c+1, r), (c+s, r+1)].
    for (const [c, r] of [
      [2, 2],
      [2, 3],
      [0, 1],
      [5, 6],
    ] as const) {
      const s = r & 1;
      expect(triangleANodes(c, r).map(([hx, hy]) => nodeCell(hx, hy))).toEqual([
        [c, r],
        [c + s, r + 1],
        [c + s - 1, r + 1],
      ]);
      expect(triangleBNodes(c, r).map(([hx, hy]) => nodeCell(hx, hy))).toEqual([
        [c, r],
        [c + 1, r],
        [c + s, r + 1],
      ]);
    }
  });

  it('adjacent triangles share identical nodes (a watertight mesh)', () => {
    // One cell's A and B share the apex and the SE-below node…
    expect(triangleANodes(2, 2)[0]).toEqual(triangleBNodes(2, 2)[0]);
    expect(triangleANodes(2, 2)[1]).toEqual(triangleBNodes(2, 2)[2]);
    // …and the east neighbour's A reuses this cell's SE node as its SW node.
    expect(triangleANodes(3, 2)[2]).toEqual(triangleANodes(2, 2)[1]);
  });

  it('spans one full row step down and half a cell out — the screen extents the cull box covers', () => {
    const [apex, se, sw] = triangleANodes(2, 2);
    const top = halfCellToScreen(...apex);
    const right = halfCellToScreen(...se);
    const left = halfCellToScreen(...sw);
    expect(right.y - top.y).toBe(TILE_HALF_H);
    expect(right.x - top.x).toBe(TILE_HALF_W);
    expect(top.x - left.x).toBe(TILE_HALF_W);
  });
});

describe('nodeLift — per-node elevation, border clamped to 0', () => {
  // 5×5 grid, elevation(col,row) = col·10 + row, sampled at exact cell coords.
  const W = 5;
  const H = 5;
  const liftAt = (col: number, row: number): number => col * 10 + row;

  it("an interior node lifts by its OWN cell's value (no blending at mesh vertices)", () => {
    expect(nodeLift(liftAt, ...cellNode(2, 2), W, H)).toBe(22);
    expect(nodeLift(liftAt, ...cellNode(1, 3), W, H)).toBe(13); // odd row
  });

  it('nodes on the map-border ring clamp to 0 (the engine zeroes border elevation)', () => {
    for (const [col, row] of [
      [0, 2],
      [2, 0],
      [4, 2],
      [2, 4],
      [0, 0],
    ] as const) {
      expect(nodeLift(liftAt, ...cellNode(col, row), W, H)).toBe(0);
    }
  });

  it("nodes beyond the grid (a border cell's below-row triangle vertices) clamp to 0 too", () => {
    // Cell (2, 4) is the last row; its A triangle references row-5 centres that do not exist.
    const [, se, sw] = triangleANodes(2, 4);
    expect(nodeLift(liftAt, ...se, W, H)).toBe(0);
    expect(nodeLift(liftAt, ...sw, W, H)).toBe(0);
  });
});

describe("nodeLaneUV — brightness-lane texel centres at each node's own cell", () => {
  it("maps an interior node to its cell's texel centre over the PADDED width", () => {
    const [hx, hy] = cellNode(2, 3);
    expect(nodeLaneUV(hx, hy, 5, 5, 8)).toEqual([(2 + 0.5) / 8, (3 + 0.5) / 5]);
  });

  it('clamps an outside-the-grid node to the boundary cell (edge-clamp semantics)', () => {
    const [, se] = triangleANodes(4, 4); // references cell (4, 5) on a 5×5 grid → clamps to row 4
    expect(nodeLaneUV(...se, 5, 5, 8)).toEqual([(4 + 0.5) / 8, (4 + 0.5) / 5]);
  });
});

describe('transitionRef — the emt lane value decode', () => {
  it('treats 255 as "no overlay"', () => {
    expect(transitionRef(TRANSITION_NONE)).toBeUndefined();
  });

  it('splits v into transition ⌊v/6⌋ and pair v%6', () => {
    expect(transitionRef(0)).toEqual({ transition: 0, pair: 0 });
    expect(transitionRef(5)).toEqual({ transition: 0, pair: 5 });
    expect(transitionRef(7)).toEqual({ transition: 1, pair: 1 });
    expect(transitionRef(23)).toEqual({ transition: 3, pair: 5 });
  });
});

describe('triangleUVs', () => {
  it('normalises a pattern triangle`s pixel coords over the page in point order', () => {
    // The canonical coordsA convention (TL, BR, BL of a 64px tile) on a 256×256 page.
    expect(triangleUVs([0, 0, 63, 63, 0, 63], 256, 256)).toEqual([0, 0, 63 / 256, 63 / 256, 0, 63 / 256]);
  });

  it('handles a block tile deeper in the page (the transition-tile case)', () => {
    // "block water shallow 00 03 02" coordsA: (192,128) (255,191) (192,191) on a 256×256 page.
    expect(triangleUVs([192, 128, 255, 191, 192, 191], 256, 256)).toEqual([
      0.75,
      0.5,
      255 / 256,
      191 / 256,
      0.75,
      191 / 256,
    ]);
  });
});

describe('rectTriangleUVs — the per-typeId fold onto the two triangles', () => {
  const rect = { x: 64, y: 128, w: 64, h: 64 };

  it("triangle a gets the rect's (TL, BR, BL) — the pattern-record point convention", () => {
    expect(rectTriangleUVs(rect, 'a', 256, 256)).toEqual([
      64 / 256,
      128 / 256,
      128 / 256,
      192 / 256,
      64 / 256,
      192 / 256,
    ]);
  });

  it("triangle b gets the rect's (TL, TR, BR)", () => {
    expect(rectTriangleUVs(rect, 'b', 256, 256)).toEqual([
      64 / 256,
      128 / 256,
      128 / 256,
      128 / 256,
      128 / 256,
      192 / 256,
    ]);
  });
});

describe('patternSrcRect', () => {
  it('returns the bounding box (in texture pixels) of the two UV triangles', () => {
    // A representative full-tile pattern: coordsA + coordsB span the 64×64 top-left tile of the page.
    const rect = patternSrcRect([0, 0, 63, 63, 0, 63], [0, 0, 63, 0, 63, 63]);
    expect(rect).toEqual({ x: 0, y: 0, w: 63, h: 63 });
  });

  it('handles a tile offset within the page (a lower sub-rect)', () => {
    // "sand 01" sat at y=128 in its page (coords [0,128,63,191,0,191] / [0,128,63,128,63,191]).
    const rect = patternSrcRect([0, 128, 63, 191, 0, 191], [0, 128, 63, 128, 63, 191]);
    expect(rect).toEqual({ x: 0, y: 128, w: 63, h: 63 });
  });
});
