import { describe, expect, it } from 'vitest';
import { type CellId, type TerrainMap, buildTerrainGraph, findPath } from '../src/index.js';
import type { TerrainGraph } from '../src/terrain.js';
import { testContent } from './fixtures/content.js';

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

  it('path length equals Manhattan distance + 1 on an obstacle-free grid', () => {
    const g = grid(5, 5, new Array(25).fill(GRASS));
    const a = g.cellAt(0, 0);
    const b = g.cellAt(4, 3);
    const path = findPath(g, a, b);
    expect(path).not.toBeNull();
    // 4-connected, unit cost: optimal length is |dx| + |dy| + 1 cells.
    expect(path?.length).toBe(4 + 3 + 1);
    // First and last cells are the endpoints; the path is contiguous (each step a graph neighbour).
    expect(path?.[0]).toBe(a);
    expect(path?.[path.length - 1]).toBe(b);
  });

  it('every step in a returned path is a walkable 4-neighbour of the previous', () => {
    const g = grid(5, 5, new Array(25).fill(GRASS));
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(4, 4));
    expect(path).not.toBeNull();
    for (let i = 1; i < (path?.length ?? 0); i++) {
      const prev = path?.[i - 1] as CellId;
      const cur = path?.[i] as CellId;
      expect(g.walkableNeighbours(prev)).toContain(cur);
    }
  });
});

describe('findPath — routes around obstacles', () => {
  it('detours around a water wall with a single gap', () => {
    // 3x3 with a vertical water wall at x=1 except the bottom row open at (1,2):
    //   G W G
    //   G W G
    //   G G G
    const g = grid(3, 3, [GRASS, WATER, GRASS, GRASS, WATER, GRASS, GRASS, GRASS, GRASS]);
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(2, 0));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 }, // through the gap
      { x: 2, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
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

  it('with equal-cost choices, the canonical N,E,S,W expansion gives a stable, predictable route', () => {
    // Open 3x3; from corner (0,0) to opposite corner (2,2) many equal-length L-paths exist. The
    // canonical neighbour order + lowest-h tie-break fixes exactly one. Pin it so a future change to
    // the selection rule is caught, not silently accepted.
    const g = grid(3, 3, new Array(9).fill(GRASS));
    const path = findPath(g, g.cellAt(0, 0), g.cellAt(2, 2));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ]);
  });
});
