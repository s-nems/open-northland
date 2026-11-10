import { describe, expect, it } from 'vitest';
import {
  buildTerrainGraph,
  findPath,
  type NodeId,
  Rng,
  type TerrainGraph,
  type TerrainMap,
} from '../../src/index.js';
import { nearestCorridorStop } from '../../src/nav/pathfinding/corridor.js';
import {
  FLOOD_GUARD_MAX_EXPLORED,
  findPathWithin,
  joinCorridor,
  POCKET_PROBE_MAX_EXPLORED,
  RACE_SLICE_EXPLORED,
} from '../../src/nav/pathfinding/index.js';
import { latticeOffsetDistance, StepBuffer } from '../../src/nav/terrain/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit tests for A* on the terrain HALF-CELL ADJACENCY GRAPH. The fixture's landscape table has
 * typeId 0 = grass (walkable) and 1 = water (not walkable). Grids here are authored directly at
 * NODE resolution (the `2W×2H` lattice - edges: E/W (±1,0) @ ½ and the four row-crossing edges, each a
 * quarter column sideways, @ ≈0.375). These pin route correctness
 * AND the deterministic, history-independent tie-breaking the lockstep replay invariant depends on.
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

describe('findPath - endpoints and degenerate cases', () => {
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

describe('findPath - shortest route on an open grid', () => {
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

  it('takes one row-crossing edge per half-row plus the half-columns those leave over', () => {
    const g = open(10, 8);
    const a = g.nodeAt(0, 0);
    const b = g.nodeAt(5, 3);
    const path = findPath(g, a, b);
    expect(path).not.toBeNull();
    // Eleven quarter columns east and three half-rows: three row-crossing edges cover three quarters,
    // four E steps the other eight - 7 steps, 8 nodes; no cheaper composition exists.
    expect(path?.length).toBe(8);
    expect(path?.[0]).toBe(a);
    expect(path?.[path.length - 1]).toBe(b);
  });

  it('a screen-straight diagonal target is reached along one heading (a straight line)', () => {
    // (0,0) -> (2,4) lies exactly down-right on screen: four SE edges, each a quarter column east, the
    // only walk of four row-crossing edges that ends there.
    const g = open(5, 5);
    const path = findPath(g, g.nodeAt(0, 0), g.nodeAt(2, 4));
    expect(coords(g, path)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 4 },
    ]);
  });

  it('a straight-down-the-screen target zigzags a quarter column either side of the line', () => {
    // (2,0) -> (2,4): four row-crossing edges, alternating SW and SE; every such walk ties, and the
    // line-deviation key keeps it within a quarter column of the line.
    const g = open(5, 5);
    const path = findPath(g, g.nodeAt(2, 0), g.nodeAt(2, 4));
    expect(coords(g, path)).toEqual([
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 4 },
    ]);
  });

  it('slides a quarter column further to pass a blocked node at no cost, west winning the mirror tie', () => {
    // (2,0) -> (2,4) with water at (2,2): the walk takes (1,2) instead, still four row-crossing edges.
    // The mirror slide through (3,2) ties on cost and line deviation, so the cell id pins the WEST one -
    // a pinned canonical pick (a moved expectation here is a lockstep replay-compatibility event).
    const typeIds = new Array(25).fill(GRASS);
    typeIds[2 * 5 + 2] = WATER;
    const g = grid(5, 5, typeIds);
    const path = findPath(g, g.nodeAt(2, 0), g.nodeAt(2, 4));
    expect(coords(g, path)).toEqual([
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
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
      // steps() is the pathfinder's edge set: the six lattice edges.
      expect(g.steps(prev).map((s) => s.node)).toContain(cur);
    }
  });
});

describe('findPath - routes around obstacles', () => {
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
});

/** The pocket's inner corners: 16 by 16 nodes, past the goal side's 128-settle probe. */
const POCKET_LOW = 25;
const POCKET_HIGH = 40;

describe('findPath - deterministic tie-breaking', () => {
  /** A walk-block ANNULUS sealing node (40,40) on an 80×80 grid: nodes at Chebyshev distance 3..4
   *  from it. Thickness 2 seals the one-node step reach with room to spare, leaving a ~25-node pocket
   *  around the centre. */
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
    // exhaust the ~25-node pocket instead, after the forward search's own probe-sized head. The explored
    // bound is the test's teeth: without the probe it lands in the thousands.
    const g = open(80, 80);
    const blocked = sealedAnnulus(g);
    const stats = { explored: 0 };
    expect(findPath(g, g.nodeAt(2, 2), g.nodeAt(40, 40), blocked, stats)).toBeNull();
    expect(stats.explored).toBeLessThanOrEqual(2 * POCKET_PROBE_MAX_EXPLORED);
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
    // sealed: the probe must still run - its reverse view re-admits the start as the target exactly
    // as the forward search exempts it - or this request would flood the whole grid.
    const g = open(80, 80);
    const blocked = sealedAnnulus(g);
    const start = g.nodeAt(2, 2);
    blocked.add(start);
    const stats = { explored: 0 };
    expect(findPath(g, start, g.nodeAt(40, 40), blocked, stats)).toBeNull();
    expect(stats.explored).toBeLessThanOrEqual(2 * POCKET_PROBE_MAX_EXPLORED);
  });

  it('reaches a goal whose only way in is the edge from the blocked start, at pocket cost', () => {
    // The goal's five other edges are blocked; the one left leads to the walker's own blocked node, which
    // the step-off exemption lets it leave. The goal side re-admits that start and proves the route at
    // the pocket's size, so no forward flood of the grid runs first.
    const g = open(80, 80);
    const start = g.nodeAt(41, 41);
    const goal = g.nodeAt(41, 40); // the start's NW neighbour, straight up from an odd row
    const blocked = new Set<NodeId>([start]);
    for (const [x, y] of [
      [42, 40],
      [40, 40],
      [41, 39],
      [40, 39],
      [40, 41],
    ] as const) {
      blocked.add(g.nodeAt(x, y));
    }
    const stats = { explored: 0 };
    expect(findPath(g, start, goal, blocked, stats)).toEqual([start, goal]);
    expect(stats.explored).toBeLessThanOrEqual(POCKET_PROBE_MAX_EXPLORED);
  });

  it.each([{ gap: false }, { gap: true }])(
    'answers as one unguarded forward search when a pocket outgrows the probe (gap $gap)',
    ({ gap }) => {
      // A walled pocket larger than the probe, its wall corner the walker's own blocked node, which no
      // lattice edge joins to the inside: the probe gives up at its cap and the race decides, exhausting
      // the pocket without a gap and finding the route through one.
      const g = open(80, 80);
      const low = POCKET_LOW;
      const blocked = new Set<NodeId>();
      for (let i = low - 1; i <= POCKET_HIGH + 1; i++) {
        blocked.add(g.nodeAt(low - 1, i));
        blocked.add(g.nodeAt(POCKET_HIGH + 1, i));
        blocked.add(g.nodeAt(i, low - 1));
        blocked.add(g.nodeAt(i, POCKET_HIGH + 1));
      }
      blocked.add(g.nodeAt(POCKET_HIGH, POCKET_HIGH - 1));
      if (gap) blocked.delete(g.nodeAt(low - 1, (low + POCKET_HIGH) >> 1));
      const start = g.nodeAt(POCKET_HIGH + 1, POCKET_HIGH + 1);
      for (const [x, y] of [
        [POCKET_HIGH, POCKET_HIGH],
        [low, low],
        [(low + POCKET_HIGH) >> 1, POCKET_HIGH],
      ] as const) {
        const goal = g.nodeAt(x, y);
        const forward = findPathWithin(g, start, goal, blocked, { explored: 0 }, Number.POSITIVE_INFINITY);
        expect(findPath(g, start, goal, blocked)).toEqual(typeof forward === 'string' ? null : forward);
      }
    },
  );

  it('answers as one unguarded forward search under random overlays with a blocked start', () => {
    const size = 24;
    const g = open(size, size);
    let seed = 12345;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % bound;
    };
    const trials = 400;
    const blockedPercent = 40;
    for (let trial = 0; trial < trials; trial++) {
      const blocked = new Set<NodeId>();
      for (let node = 0; node < g.nodeCount; node++) {
        if (next(100) < blockedPercent) blocked.add(node as NodeId);
      }
      const start = g.nodeAt(next(size), next(size));
      const goal = g.nodeAt(next(size), next(size));
      blocked.add(start);
      blocked.delete(goal);
      const forward = findPathWithin(g, start, goal, blocked, { explored: 0 }, Number.POSITIVE_INFINITY);
      expect(findPath(g, start, goal, blocked)).toEqual(typeof forward === 'string' ? null : forward);
    }
  });

  it('finds a route longer than the probe cap when the overlay does not seal it', () => {
    // Distant corners on a big grid with one stray blocked node: the forward head and the probe both hit
    // their caps inconclusively and the full search must still deliver the route.
    const g = open(200, 200);
    const blocked = new Set<NodeId>([g.nodeAt(10, 10)]);
    const stats = { explored: 0 };
    const path = findPath(g, g.nodeAt(0, 0), g.nodeAt(199, 199), blocked, stats);
    expect(path).not.toBeNull();
    expect(stats.explored).toBeGreaterThan(2 * POCKET_PROBE_MAX_EXPLORED);
  });

  it.each([
    { inner: 10, pocket: 19 * 19 },
    { inner: 25, pocket: 49 * 49 },
  ])(
    'refutes a sealed $pocket-node pocket past the probe cap at about twice pocket cost, not a map flood',
    ({ inner, pocket }) => {
      // An annulus three nodes thick seals the goal in a pocket past the 128-settle probe, so without the
      // flood guard this request flooded the whole ~14k-node grid. Past the guard the paused forward search
      // races the goal side in equal slices, so refuting the pocket costs it once on each side.
      const g = open(120, 120);
      const blocked = new Set<NodeId>();
      const outer = inner + 2;
      for (let dx = -outer; dx <= outer; dx++) {
        for (let dy = -outer; dy <= outer; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) >= inner) blocked.add(g.nodeAt(60 + dx, 60 + dy));
        }
      }
      const stats = { explored: 0 };
      expect(findPath(g, g.nodeAt(2, 2), g.nodeAt(60, 60), blocked, stats)).toBeNull();
      expect(stats.explored).toBeGreaterThan(POCKET_PROBE_MAX_EXPLORED); // the probe alone could not decide
      expect(stats.explored).toBeLessThanOrEqual(FLOOD_GUARD_MAX_EXPLORED + 2 * pocket + RACE_SLICE_EXPLORED);
    },
  );

  it('delivers the identical route when a reachable search outgrows the flood guard, resuming it', () => {
    // A serpentine of full-width water walls (gaps alternating ends) forces a route long enough to
    // trip the guard; the tiny off-route overlay keeps the guarded pipeline engaged. The result must
    // be byte-identical to the unguarded (no-overlay) search - the guard is a pure cost knob - and the
    // paused forward search resumes rather than restarting, so past the guard each side of the race
    // pays at most the forward search's own remainder plus a slice.
    const width = 100;
    const height = 241;
    const typeIds = new Array(width * height).fill(GRASS);
    for (let wall = 0; wall * 4 + 3 < height; wall++) {
      const y = wall * 4 + 3;
      const gapWest = wall % 2 === 1;
      for (let x = 0; x < width; x++) {
        if (gapWest ? x < 4 : x >= width - 4) continue;
        typeIds[y * width + x] = WATER;
      }
    }
    const g = grid(width, height, typeIds);
    const start = g.nodeAt(10, 1);
    const goal = g.nodeAt(10, height - 4); // the last corridor band (height-2 can land on a wall row)
    const stats = { explored: 0 };
    const guarded = findPath(g, start, goal, new Set<NodeId>([g.nodeAt(0, 0)]), stats);
    const unguardedStats = { explored: 0 };
    expect(guarded).not.toBeNull();
    expect(guarded).toEqual(findPath(g, start, goal, undefined, unguardedStats));
    const forward = unguardedStats.explored;
    expect(forward).toBeGreaterThan(FLOOD_GUARD_MAX_EXPLORED);
    expect(stats.explored).toBeLessThanOrEqual(
      POCKET_PROBE_MAX_EXPLORED + forward + (forward - FLOOD_GUARD_MAX_EXPLORED) + RACE_SLICE_EXPLORED,
    );
  });

  it('breaks a cost-tie between equal lattice routes canonically (a pinned pick)', () => {
    // Open 6×6, (1,1) -> (3,3): two row-crossing edges and one half-column, reachable by equal-cost
    // step orders. The canonical (f, h, dev, cell-id) tie-break picks ONE of them history-independently -
    // the h key settles it (the half-column first leaves the smaller remaining heuristic). This pins that
    // pick - a moved expectation here means the lockstep path choice changed, which is a
    // replay-compatibility event, not a style nit.
    const g = open(6, 6);
    const path = findPath(g, g.nodeAt(1, 1), g.nodeAt(3, 3));
    expect(coords(g, path)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ]);
  });
});

describe('nearestCorridorStop', () => {
  it('skips corridor blocks exactly as a linear scan picks', () => {
    const g = open(120, 120);
    const rng = new Rng(11);
    for (let trial = 0; trial < 40; trial++) {
      // A random walk of lattice steps, long enough for several blocks.
      const corridor: NodeId[] = [g.nodeAt(60, 60)];
      const steps = new StepBuffer();
      while (corridor.length < 64 + rng.int(200)) {
        const at = corridor.at(-1) ?? g.nodeAt(60, 60);
        g.stepsInto(at, undefined, steps);
        corridor.push(steps.nodeAt(rng.int(steps.length)));
      }
      const blocked = new Set<NodeId>(corridor.filter(() => rng.int(4) === 0));
      const target = g.nodeAt(rng.int(120), rng.int(120));
      const from = rng.int(corridor.length);
      let expected: { index: number; node: NodeId } | undefined;
      let best = 0;
      let bestSideways = 0;
      for (let index = from; index < corridor.length; index++) {
        const node = corridor[index];
        if (node === undefined || blocked.has(node)) continue;
        const distance = latticeOffsetDistance(
          g.xOf(node) - g.xOf(target),
          g.yOf(node) - g.yOf(target),
          g.yOf(target),
        );
        const sideways = Math.abs(
          2 * g.xOf(node) + (g.yOf(node) & 1) - 2 * g.xOf(target) - (g.yOf(target) & 1),
        );
        if (expected !== undefined && (distance > best || (distance === best && sideways >= bestSideways)))
          continue;
        expected = { index, node };
        best = distance;
        bestSideways = sideways;
      }
      expect(nearestCorridorStop(g, corridor, target, from, blocked)).toEqual(expected);
    }
  });
});

describe('joinCorridor - a group member borrowing a routed corridor', () => {
  const LEAD_ROW = 10;
  const FOLLOWER_ROW = 30;
  const WALL_ROW = 20;
  const WALL_END_HX = 40;
  /** Far enough for a hop across the twenty half-rows between the lead's row and the follower's. */
  const NEAR = 24;

  /** Every consecutive pair of `path` is a pathfinder edge under `blocked`. */
  function isWalkablePath(g: TerrainGraph, path: readonly NodeId[], blocked: ReadonlySet<NodeId>): boolean {
    return path.every((node, i) => {
      const previous = path[i - 1];
      return previous === undefined || g.steps(previous, blocked).some((step) => step.node === node);
    });
  }

  function lead(g: TerrainGraph): NodeId[] {
    const corridor = findPath(g, g.nodeAt(10, LEAD_ROW), g.nodeAt(150, LEAD_ROW));
    if (corridor === null) throw new Error('the lead routes');
    return corridor;
  }

  it('joins an open corridor with a walkable route from its own start to its own goal', () => {
    const g = open(160, 60);
    const start = g.nodeAt(12, FOLLOWER_ROW);
    const goal = g.nodeAt(148, FOLLOWER_ROW);
    const joined = joinCorridor(g, lead(g), start, goal, new Set<NodeId>(), { explored: 0 }, NEAR);
    expect(joined?.[0]).toBe(start);
    expect(joined?.at(-1)).toBe(goal);
    expect(isWalkablePath(g, joined ?? [], new Set())).toBe(true);
  });

  it('refuses a member whose start lies farther than the hop from every corridor node', () => {
    const g = open(160, 60);
    const far = g.nodeAt(80, LEAD_ROW + NEAR + 2);
    expect(
      joinCorridor(g, lead(g), far, g.nodeAt(148, LEAD_ROW), new Set<NodeId>(), { explored: 0 }, NEAR),
    ).toBeNull();
  });

  it('refuses a corridor it could only reach round a wall, so the member routes alone', () => {
    // The corridor node nearest the start lies across a wall: reaching it means walking to the wall's
    // end and back, then along the corridor past the start again.
    const g = open(160, 60);
    const wall = new Set<NodeId>();
    for (let hx = 0; hx <= WALL_END_HX; hx++) wall.add(g.nodeAt(hx, WALL_ROW));
    const corridor = findPath(g, g.nodeAt(10, LEAD_ROW), g.nodeAt(150, LEAD_ROW), wall);
    if (corridor === null) throw new Error('the lead routes');
    const joined = joinCorridor(
      g,
      corridor,
      g.nodeAt(12, FOLLOWER_ROW),
      g.nodeAt(148, FOLLOWER_ROW),
      wall,
      { explored: 0 },
      NEAR,
    );
    expect(joined).toBeNull();
  });
});
