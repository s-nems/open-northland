import { describe, expect, it } from 'vitest';
import {
  type CellId,
  type TerrainGraph,
  type TerrainMap,
  buildTerrainGraph,
  findPath,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit tests for A* on the terrain CELL-ADJACENCY GRAPH. The fixture's landscape table has
 * typeId 0 = grass (walkable) and 1 = water (not walkable). These pin route correctness AND the
 * deterministic, history-independent tie-breaking the lockstep replay invariant depends on.
 */

const GRASS = 0;
const WATER = 1;

/** Build a graph from a row-major typeId grid (0=grass, 1=water). */
function grid(width: number, height: number, typeIds: number[]): TerrainGraph {
  const map: TerrainMap = { width, height, typeIds };
  return buildTerrainGraph(testContent(), map);
}

/** Map a path to (x,y) pairs for readable assertions. */
function coords(g: TerrainGraph, path: CellId[] | null): Array<{ x: number; y: number }> | null {
  return path === null ? null : path.map((c) => g.coordsOf(c));
}

describe('findPath — endpoints and degenerate cases', () => {
  it('start === goal yields a single-cell path', () => {
    const g = grid(3, 3, [GRASS, GRASS, GRASS, GRASS, GRASS, GRASS, GRASS, GRASS, GRASS]);
    const start = g.cellAt(1, 1);
    expect(findPath(g, start, start)).toEqual([start]);
  });

  it('returns null when the start cell is unwalkable', () => {
    const g = grid(3, 1, [WATER, GRASS, GRASS]);
    expect(findPath(g, g.cellAt(0, 0), g.cellAt(2, 0))).toBeNull();
  });

  it('returns null when the goal cell is unwalkable', () => {
    const g = grid(3, 1, [GRASS, GRASS, WATER]);
    expect(findPath(g, g.cellAt(0, 0), g.cellAt(2, 0))).toBeNull();
  });

  it('returns null when the goal is walkable but unreachable (walled off)', () => {
    // A 3x1 strip with a water cell in the middle isolates the two grass ends.
    const g = grid(3, 1, [GRASS, WATER, GRASS]);
    expect(findPath(g, g.cellAt(0, 0), g.cellAt(2, 0))).toBeNull();
  });
});

describe('findPath — shortest route on an open grid', () => {
  it('finds a minimal-length path across an all-grass row', () => {
    const g = grid(4, 1, [GRASS, GRASS, GRASS, GRASS]);
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(3, 0));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('takes |Δrow| row-crossings plus the un-absorbed columns on an obstacle-free grid', () => {
    const g = grid(5, 5, new Array(25).fill(GRASS));
    const a = g.cellAt(0, 0);
    const b = g.cellAt(4, 3);
    const path = findPath(g, a, b);
    expect(path).not.toBeNull();
    // Staggered lattice: 3 row-crossings (each sliding half a column toward the target) + 3 full
    // column steps cover the 4.5-column world-x offset — 6 steps, 7 cells.
    expect(path?.length).toBe(7);
    // First and last cells are the endpoints; the path is contiguous (each step a graph neighbour).
    expect(path?.[0]).toBe(a);
    expect(path?.[path.length - 1]).toBe(b);
  });

  it('a screen-straight diagonal target is reached by the alternating lattice edges (a straight line)', () => {
    // (0,0) -> (2,4) lies exactly down-right on screen: four SE lattice edges — (0,+1) from an even
    // row, (+1,+1) from an odd one — trace the straight screen line, and no cheaper route exists (the
    // parity alternation is forced), so the pick is tie-free.
    const g = grid(5, 5, new Array(25).fill(GRASS));
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(2, 4));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 4 },
    ]);
  });

  it('a straight-down-the-screen target routes as straight vertical steps — no weave', () => {
    // (2,0) -> (2,4): straight down on screen. The vertical S lattice step (two rows through the
    // flanked gap) makes this a true straight line — and it is strictly cheaper than any SE/SW
    // weave (2·VERTICAL_STEP ≈ 2.24 columns vs 4·DIAGONAL_STEP ≈ 3.0), so the pick is tie-free.
    const g = grid(5, 5, new Array(25).fill(GRASS));
    const path = findPath(g, g.cellAt(2, 0), g.cellAt(2, 4));
    expect(coords(g, path)).toEqual([
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
    ]);
  });

  it('slides a vertical run half a column to pass a blocked cell, staying inside the half-cell band', () => {
    // (2,0) -> (2,4) with water at (2,2): the straight column is broken, but a diagonal onto the
    // neighbouring seam re-opens a vertical step (its far flank is grass), so the route is
    // diagonal + vertical + diagonal — never the wide zigzag. The two mirror slides tie on cost;
    // assert the shape (monotone rows, bounded wobble), not one canonical pick.
    const typeIds = new Array(25).fill(GRASS);
    typeIds[2 * 5 + 2] = WATER;
    const g = grid(5, 5, typeIds);
    const path = findPath(g, g.cellAt(2, 0), g.cellAt(2, 4));
    expect(path).not.toBeNull();
    const cells = coords(g, path) ?? [];
    expect(cells.map((c) => c.y)).toEqual([0, 1, 3, 4]); // diagonal, vertical, diagonal
    for (const c of cells) {
      const worldXcols = c.x + (c.y & 1) * 0.5; // the cell centre's world-x in column units
      expect(Math.abs(worldXcols - 2)).toBeLessThanOrEqual(0.5); // never leaves the half-cell band
    }
  });

  it('every step in a returned path is a walkable lattice neighbour of the previous', () => {
    const g = grid(5, 5, new Array(25).fill(GRASS));
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(4, 4));
    expect(path).not.toBeNull();
    for (let i = 1; i < (path?.length ?? 0); i++) {
      const prev = path?.[i - 1] as CellId;
      const cur = path?.[i] as CellId;
      // steps() is the pathfinder's 8-direction staggered-lattice edge set.
      expect(g.steps(prev).map((s) => s.cell)).toContain(cur);
    }
  });
});

describe('findPath — routes around obstacles', () => {
  it('detours around a water wall with a single gap', () => {
    // 3x3 with a vertical water wall at x=1 except the bottom row open at (1,2):
    //   G W G
    //   G W G
    //   G G G
    // The lattice route drops through the SE edges to the gap ((0,1) is an odd row, so its SE edge
    // is (+1,+1) — straight into the gap cell), steps E, and climbs back with ONE straight vertical
    // N step — its NE flank (2,1) is grass, so the seam past the water at (1,1) is open, and
    // VERTICAL_STEP beats the NE+NW pair (≈1.12 vs ≈1.50). Unique optimum, tie-free.
    const g = grid(3, 3, [GRASS, WATER, GRASS, GRASS, WATER, GRASS, GRASS, GRASS, GRASS]);
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(2, 0));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 2 }, // through the gap
      { x: 2, y: 2 },
      { x: 2, y: 0 }, // straight up the flanked seam
    ]);
  });

  it('routes to the interlocked half-shifted cell over a real lattice edge, never a long jump', () => {
    // 2x2 with water at (1,0). (1,1) is NOT adjacent to (0,0) on the lattice (their diamonds only
    // interlock via the row between), so the route goes through (0,1) — whose E neighbour is the goal.
    const g = grid(2, 2, [GRASS, WATER, GRASS, GRASS]);
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(1, 1));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });
});

describe('findPath — deterministic tie-breaking', () => {
  it('picks the same path across repeated calls (history-independent)', () => {
    const g = grid(5, 5, new Array(25).fill(GRASS));
    const a = g.cellAt(0, 0);
    const b = g.cellAt(4, 4);
    const first = findPath(g, a, b);
    for (let i = 0; i < 5; i++) expect(findPath(g, a, b)).toEqual(first);
  });

  it('picks the same path across independently-built identical graphs (lockstep-equal)', () => {
    const ga = grid(5, 5, new Array(25).fill(GRASS));
    const gb = grid(5, 5, new Array(25).fill(GRASS));
    const a = 0 as CellId;
    const b = 24 as CellId;
    // Cell ids are identical across the two graphs (same dims), so the paths must be id-for-id equal.
    expect(findPath(ga, a, b)).toEqual(findPath(gb, a, b));
  });

  it('breaks a cost-tie between equal lattice routes canonically (a pinned pick)', () => {
    // Open 3x3, (0,0) -> (2,2): cost 2·DIAGONAL_STEP + ONE, reachable by three equal-cost step
    // orders (E first, E in the middle, E last). The canonical (f, h, cell-id) tie-break picks ONE of
    // them history-independently; this pins that pick — a moved expectation here means the lockstep
    // path choice changed, which is a replay-compatibility event, not a style nit.
    const g = grid(3, 3, new Array(9).fill(GRASS));
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(2, 2));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });
});
