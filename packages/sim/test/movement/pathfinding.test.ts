import { describe, expect, it } from 'vitest';
import {
  type NodeId,
  type TerrainGraph,
  type TerrainMap,
  buildTerrainGraph,
  findPath,
} from '../../src/index.js';
import { POCKET_PROBE_MAX_EXPLORED } from '../../src/nav/pathfinding.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit tests for A* on the terrain HALF-CELL ADJACENCY GRAPH. The fixture's landscape table has
 * typeId 0 = grass (walkable) and 1 = water (not walkable). Grids here are authored directly at
 * NODE resolution (the `2W×2H` lattice — edges: E/W (±1,0) @ ½, diagonals (±1,±2) @ ≈¾, N/S (0,±1)
 * @ ≈0.28). These pin route correctness AND the deterministic, history-independent tie-breaking the
 * lockstep replay invariant depends on.
 */

const GRASS = 0;
const WATER = 1;

/** Build a graph from a row-major NODE typeId grid (0=grass, 1=water). */
function grid(width: number, height: number, typeIds: number[]): TerrainGraph {
  const map: TerrainMap = { resolution: 'half-cell', width, height, typeIds };
  return buildTerrainGraph(testContent(), map);
}

/** An all-grass node grid. */
function open(width: number, height: number): TerrainGraph {
  return grid(width, height, new Array(width * height).fill(GRASS));
}

/** Map a path to (x,y) pairs for readable assertions. */
function coords(g: TerrainGraph, path: NodeId[] | null): Array<{ x: number; y: number }> | null {
  return path === null ? null : path.map((c) => g.coordsOf(c));
}

describe('findPath — endpoints and degenerate cases', () => {
  it('start === goal yields a single-node path', () => {
    const g = open(3, 3);
    const start = g.nodeAt(1, 1);
    expect(findPath(g, start, start)).toEqual([start]);
  });

  it('returns null when the start node is unwalkable', () => {
    const g = grid(3, 1, [WATER, GRASS, GRASS]);
    expect(findPath(g, g.nodeAt(0, 0), g.nodeAt(2, 0))).toBeNull();
  });

  it('returns null when the goal node is unwalkable', () => {
    const g = grid(3, 1, [GRASS, GRASS, WATER]);
    expect(findPath(g, g.nodeAt(0, 0), g.nodeAt(2, 0))).toBeNull();
  });

  it('returns null when the goal is walkable but unreachable (walled off)', () => {
    // A 3x1 strip with a water node in the middle isolates the two grass ends (a 1-node-tall strip
    // has no diagonal or vertical edges to slip past it).
    const g = grid(3, 1, [GRASS, WATER, GRASS]);
    expect(findPath(g, g.nodeAt(0, 0), g.nodeAt(2, 0))).toBeNull();
  });
});

describe('findPath — shortest route on an open grid', () => {
  it('finds a minimal-length path across an all-grass row', () => {
    const g = open(4, 1);
    const path = findPath(g, g.nodeAt(0, 0), g.nodeAt(3, 0));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('takes ⌊Δhy/2⌋ diagonals plus the un-absorbed half-columns and half-rows', () => {
    const g = open(10, 8);
    const a = g.nodeAt(0, 0);
    const b = g.nodeAt(5, 3);
    const path = findPath(g, a, b);
    expect(path).not.toBeNull();
    // ax=5, ay=3: one diagonal (absorbing two half-rows and one half-column), four E steps, one
    // half-row step — 6 steps, 7 nodes; no cheaper composition exists (heuristic exactness).
    expect(path?.length).toBe(7);
    expect(path?.[0]).toBe(a);
    expect(path?.[path.length - 1]).toBe(b);
  });

  it('a screen-straight diagonal target is reached by pure diagonal edges (a straight line)', () => {
    // (0,0) -> (2,4) lies exactly down-right on screen: two SE lattice edges. Strictly cheaper than
    // any straight-step substitute (2·DIAGONAL_STEP ≈ 1.50 vs e.g. 2 E + 4 N ≈ 2.12), so tie-free.
    const g = open(5, 5);
    const path = findPath(g, g.nodeAt(0, 0), g.nodeAt(2, 4));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ]);
  });

  it('a straight-down-the-screen target routes as straight half-row steps — no weave', () => {
    // (2,0) -> (2,4): four N/S half-row steps (4·HALF_ROW ≈ 1.12) strictly beat any diagonal pair
    // (2·DIAGONAL_STEP ≈ 1.50), so the pick is tie-free — the walker holds its world column exactly.
    const g = open(5, 5);
    const path = findPath(g, g.nodeAt(2, 0), g.nodeAt(2, 4));
    expect(coords(g, path)).toEqual([
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
    ]);
  });

  it('slides half a column to pass a blocked node, west slide winning the mirror tie canonically', () => {
    // (2,0) -> (2,4) with water at (2,2): the straight half-row column is broken. The two mirror
    // slides (via (1,2) or (3,2), each two diagonal edges, cost 2·DIAGONAL_STEP ≈ 1.50) tie on cost
    // AND on line-deviation, so the cell-id tie-break pins the WEST slide — a pinned canonical pick
    // (a moved expectation here is a lockstep replay-compatibility event, not a style nit).
    const typeIds = new Array(25).fill(GRASS);
    typeIds[2 * 5 + 2] = WATER;
    const g = grid(5, 5, typeIds);
    const path = findPath(g, g.nodeAt(2, 0), g.nodeAt(2, 4));
    expect(coords(g, path)).toEqual([
      { x: 2, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ]);
  });

  it('every step in a returned path is a walkable lattice neighbour of the previous', () => {
    const g = open(6, 6);
    const path = findPath(g, g.nodeAt(0, 0), g.nodeAt(5, 5));
    expect(path).not.toBeNull();
    for (let i = 1; i < (path?.length ?? 0); i++) {
      const prev = path?.[i - 1] as NodeId;
      const cur = path?.[i] as NodeId;
      // steps() is the pathfinder's 8-direction half-cell edge set.
      expect(g.steps(prev).map((s) => s.node)).toContain(cur);
    }
  });
});

describe('findPath — routes around obstacles', () => {
  it('detours under a water wall through its gap and never enters water', () => {
    // 6×6 nodes; a water wall fills column hx=3 for hy 0..3, open below (hy 4..5). A route
    // (0,2) -> (5,2) must drop below the wall and climb back.
    const typeIds = new Array(36).fill(GRASS);
    for (let hy = 0; hy <= 3; hy++) typeIds[hy * 6 + 3] = WATER;
    const g = grid(6, 6, typeIds);
    const path = findPath(g, g.nodeAt(0, 2), g.nodeAt(5, 2));
    expect(path).not.toBeNull();
    const cells = coords(g, path) ?? [];
    for (const c of cells) {
      expect(g.isWalkable(g.nodeAt(c.x, c.y))).toBe(true);
      // The wall column is only ever crossed below the wall.
      if (c.x === 3) expect(c.y).toBeGreaterThanOrEqual(4);
    }
    expect(cells[0]).toEqual({ x: 0, y: 2 });
    expect(cells[cells.length - 1]).toEqual({ x: 5, y: 2 });
  });

  it('a diagonal squeezes past a blocked flank while both-blocked flanks seal the seam', () => {
    // From (1,1) the SE edge to (2,3) passes between (1,2) and (2,2). One water flank leaves the
    // seam open; both water flanks seal it, forcing the longer way round (or no route at all here,
    // since the second row is otherwise water too).
    const oneFlank = grid(
      4,
      4,
      (() => {
        const t = new Array(16).fill(GRASS);
        t[2 * 4 + 1] = WATER; // (1,2)
        return t;
      })(),
    );
    expect(findPath(oneFlank, oneFlank.nodeAt(1, 1), oneFlank.nodeAt(2, 3))?.length).toBe(2); // the single SE edge — one flank is enough

    const sealed = grid(
      4,
      4,
      (() => {
        const t = new Array(16).fill(GRASS);
        t[2 * 4 + 0] = WATER;
        t[2 * 4 + 1] = WATER;
        t[2 * 4 + 2] = WATER;
        t[2 * 4 + 3] = WATER; // the whole row hy=2 is water
        return t;
      })(),
    );
    // With row 2 sealed, no diagonal seam stays open and no half-row step survives — unreachable.
    expect(findPath(sealed, sealed.nodeAt(1, 1), sealed.nodeAt(2, 3))).toBeNull();
  });
});

describe('findPath — deterministic tie-breaking', () => {
  it('picks the same path across repeated calls (history-independent)', () => {
    const g = open(6, 6);
    const a = g.nodeAt(0, 0);
    const b = g.nodeAt(5, 5);
    const first = findPath(g, a, b);
    for (let i = 0; i < 5; i++) expect(findPath(g, a, b)).toEqual(first);
  });

  it('picks the same path across independently-built identical graphs (lockstep-equal)', () => {
    const ga = open(6, 6);
    const gb = open(6, 6);
    const a = 0 as NodeId;
    const b = 35 as NodeId;
    // Cell ids are identical across the two graphs (same dims), so the paths must be id-for-id equal.
    expect(findPath(ga, a, b)).toEqual(findPath(gb, a, b));
  });

  /** A walk-block ANNULUS sealing node (40,40) on an 80×80 grid: nodes at Chebyshev distance 3..4
   *  from it. Thickness 2 in y seals the ±2 diagonal/step reach (any escape from max ≤ 2 lands at
   *  max ≤ 4 — inside the ring), leaving a ~25-node pocket around the centre. */
  function sealedAnnulus(g: TerrainGraph): Set<NodeId> {
    const blocked = new Set<NodeId>();
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= 3) blocked.add(g.nodeAt(40 + dx, 40 + dy));
      }
    }
    return blocked;
  }

  it('goal sealed by the overlay fails at pocket cost, not a map flood (the probe elision)', () => {
    // Proving "no route" forward means flooding the whole 6400-node grid; the goal-side probe must
    // exhaust the ~25-node pocket instead. The explored bound is the test's teeth: without the
    // probe it lands in the thousands.
    const g = open(80, 80);
    const blocked = sealedAnnulus(g);
    const stats = { explored: 0 };
    expect(findPath(g, g.nodeAt(2, 2), g.nodeAt(40, 40), blocked, stats)).toBeNull();
    expect(stats.explored).toBeLessThanOrEqual(POCKET_PROBE_MAX_EXPLORED);
  });

  it('routes normally when start and goal share the sealed pocket', () => {
    const g = open(80, 80);
    // Both endpoints inside the ring: the probe meets the start within the pocket and the full
    // search routes as if the ring were the map edge.
    expect(findPath(g, g.nodeAt(39, 40), g.nodeAt(41, 40), sealedAnnulus(g))).not.toBeNull();
  });

  it('keeps the blocked-START step-off exemption with an overlay in play', () => {
    const g = open(10, 10);
    const start = g.nodeAt(5, 5);
    const blocked = new Set<NodeId>([start]);
    expect(findPath(g, start, g.nodeAt(8, 5), blocked)).not.toBeNull();
  });

  it('fails a sealed goal cheaply even when the START itself is walk-blocked', () => {
    // A walker standing on an overlay node (a fresh foundation, an enemy town stamp) whose goal is
    // sealed: the probe must still run — its reverse view re-admits the start as the target exactly
    // as the forward search exempts it — or this request would flood the whole grid.
    const g = open(80, 80);
    const blocked = sealedAnnulus(g);
    const start = g.nodeAt(2, 2);
    blocked.add(start);
    const stats = { explored: 0 };
    expect(findPath(g, start, g.nodeAt(40, 40), blocked, stats)).toBeNull();
    expect(stats.explored).toBeLessThanOrEqual(POCKET_PROBE_MAX_EXPLORED);
  });

  it('finds a route longer than the probe cap when the overlay does not seal it', () => {
    // Distant corners on a big grid with one stray blocked node: the probe hits its cap
    // inconclusively and the full search must still deliver the route.
    const g = open(80, 80);
    const blocked = new Set<NodeId>([g.nodeAt(10, 10)]);
    const stats = { explored: 0 };
    const path = findPath(g, g.nodeAt(0, 0), g.nodeAt(79, 79), blocked, stats);
    expect(path).not.toBeNull();
    expect(stats.explored).toBeGreaterThan(POCKET_PROBE_MAX_EXPLORED); // the cap-abort ran, then the real search
  });

  it('breaks a cost-tie between equal lattice routes canonically (a pinned pick)', () => {
    // Open 6×6, (1,1) -> (3,3): cost DIAGONAL_STEP + HALF_COLUMN, reachable by equal-cost step
    // orders (E before or after the diagonal). The canonical (f, h, dev, cell-id) tie-break picks
    // ONE of them history-independently — the h key settles it (diagonal-first leaves the smaller
    // remaining heuristic), so the route runs the diagonal before the half-column. This pins that
    // pick — a moved expectation here means the lockstep path choice changed, which is a
    // replay-compatibility event, not a style nit.
    const g = open(6, 6);
    const path = findPath(g, g.nodeAt(1, 1), g.nodeAt(3, 3));
    expect(coords(g, path)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
  });
});
