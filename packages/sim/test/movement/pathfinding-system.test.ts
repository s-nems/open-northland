import { describe, expect, it } from 'vitest';
import { PathFollow, PathRequest, Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, nodeOfPosition, ONE, Simulation, type TerrainMap } from '../../src/index.js';
import { drainPathRequests, pathfindingSystem, type SystemContext } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * Unit + integration tests for the PathfindingSystem glue - the seam that drains {@link PathRequest}
 * components, runs A* on `ctx.terrain`, and writes the route into {@link PathFollow}. The fixture's
 * landscape table has typeId 0 = grass (walkable) and 1 = water (not walkable); grids are authored
 * directly at NODE (half-cell) resolution. These pin the request→path handoff, the node-position
 * waypoints (with the diagonal midpoint splice), the failure flagging, the per-tick budget, and
 * the mapless no-op.
 */

const GRASS = 0;
const WATER = 1;

/** Exact quarter-tile fixed-point values - node positions land on quarters (ONE % 4 === 0). */
const Q = (n: number): number => (n * ONE) / 4;

/** A flat all-grass NODE grid of the given dimensions. */

/** Build a mapped sim, returning it plus a helper to enqueue a request on a fresh entity. */
function mappedSim(map: TerrainMap): { sim: Simulation; request: (start: number, goal: number) => Entity } {
  const sim = new Simulation({ seed: 1, content: testContent(), map });
  const request = (start: number, goal: number): Entity => {
    const e = sim.world.create();
    sim.world.add(e, PathRequest, { start, goal, failed: false });
    return e;
  };
  return { sim, request };
}

describe('pathfindingSystem - request to PathFollow handoff', () => {
  it('resolves a request into node-position waypoints and clears the request', () => {
    const { sim, request } = mappedSim(grassMap(4, 1));
    const start = sim.terrain?.nodeAt(0, 0) as number;
    const goal = sim.terrain?.nodeAt(3, 0) as number;
    const e = request(start, goal);

    sim.step();

    expect(sim.world.has(e, PathRequest)).toBe(false); // cleared on success
    expect(sim.world.has(e, PathFollow)).toBe(true);
    // Row 0 (even): node hx sits at grid x = hx/2 - half-tile pitch, no stagger. Each stop carries its
    // node, whose roughness paces the step off it.
    const node = (hx: number): number => sim.terrain?.nodeAt(hx, 0) as number;
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([
      { x: Q(0), y: Q(0), node: node(0) },
      { x: Q(2), y: Q(0), node: node(1) },
      { x: Q(4), y: Q(0), node: node(2) },
      { x: Q(6), y: Q(0), node: node(3) },
    ]);
    // The walker stands on the first stop, so the walk starts toward the second.
    expect(sim.world.get(e, PathFollow)).toMatchObject({ index: 1, legTicks: 0, legCost: 0 });
  });

  it('a start===goal request yields a single-node path at the node position', () => {
    const { sim, request } = mappedSim(grassMap(3, 3));
    const c = sim.terrain?.nodeAt(1, 1) as number;
    const e = request(c, c);
    sim.step();
    // Node (1,1): row ½ (stagger ¼) → grid x = ½ − ¼ = ¼.
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([{ x: Q(1), y: Q(2), node: c }]);
    expect(sim.world.get(e, PathFollow).index).toBe(0);
  });

  it("splices the midpoint into a diagonal leg leaving an odd row, as the original's between node", () => {
    // (2,1) -> (3,3) is a single SE diagonal from odd hy=1: rows ½ → 1½ cross the integer row 1
    // mid-leg, where the stagger wave kinks. The midpoint sits at the edge's world middle
    // ((2+3)/4 = 1¼ columns) expressed at row 1 (stagger ½): grid x = 1¼ − ½ = ¾. Its node is the
    // original's SE neighbour of (2,1), which from an odd row is (3,2).
    const { sim, request } = mappedSim(grassMap(5, 5));
    const e = request(sim.terrain?.nodeAt(2, 1) as number, sim.terrain?.nodeAt(3, 3) as number);
    sim.step();
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([
      { x: Q(3), y: Q(2), node: sim.terrain?.nodeAt(2, 1) }, // node (2,1): 1 − ¼
      { x: Q(3), y: Q(4), node: sim.terrain?.nodeAt(3, 2) }, // the midpoint at row 1
      { x: Q(5), y: Q(6), node: sim.terrain?.nodeAt(3, 3) }, // node (3,3): 1½ − ¼
    ]);
  });

  it('splices the midpoint into a diagonal leg between even rows too: two steps, the between node', () => {
    // (2,0) -> (3,2): rows 0 → 1, the stagger is linear across the interval, but the edge is still two
    // of the original's steps through its between node, which from an even row is (2,1).
    const { sim, request } = mappedSim(grassMap(5, 5));
    const e = request(sim.terrain?.nodeAt(2, 0) as number, sim.terrain?.nodeAt(3, 2) as number);
    sim.step();
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([
      { x: Q(4), y: Q(0), node: sim.terrain?.nodeAt(2, 0) }, // node (2,0)
      { x: Q(4), y: Q(2), node: sim.terrain?.nodeAt(2, 1) }, // the midpoint at row ½: 1¼ − ¼
      { x: Q(4), y: Q(4), node: sim.terrain?.nodeAt(3, 2) }, // node (3,2): row 1, grid x = 1½ − ½
    ]);
  });

  it('a westward diagonal picks the between node on the other side', () => {
    // (3,0) -> (2,2): SW from an even row passes (2,1); (2,1) -> (1,3): SW from an odd row passes (2,2).
    const { sim, request } = mappedSim(grassMap(5, 5));
    const e = request(sim.terrain?.nodeAt(3, 0) as number, sim.terrain?.nodeAt(2, 2) as number);
    sim.step();
    expect(sim.world.get(e, PathFollow).waypoints.map((w) => w.node)).toEqual([
      sim.terrain?.nodeAt(3, 0),
      sim.terrain?.nodeAt(2, 1),
      sim.terrain?.nodeAt(2, 2),
    ]);
    const f = request(sim.terrain?.nodeAt(2, 1) as number, sim.terrain?.nodeAt(1, 3) as number);
    sim.step();
    expect(sim.world.get(f, PathFollow).waypoints.map((w) => w.node)).toEqual([
      sim.terrain?.nodeAt(2, 1),
      sim.terrain?.nodeAt(2, 2),
      sim.terrain?.nodeAt(1, 3),
    ]);
  });
});

describe('pathfindingSystem - failure handling', () => {
  it('flags an unreachable request failed, keeps the request, and writes no path', () => {
    // 3x1 strip walled by a centre water node isolates the two grass ends.
    const map: TerrainMap = { resolution: 'half-cell', width: 3, height: 1, typeIds: [GRASS, WATER, GRASS] };
    const { sim, request } = mappedSim(map);
    const e = request(sim.terrain?.nodeAt(0, 0) as number, sim.terrain?.nodeAt(2, 0) as number);

    sim.step();

    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.has(e, PathRequest)).toBe(true);
    expect(sim.world.get(e, PathRequest).failed).toBe(true);
  });

  it('does not retry an already-failed request on later ticks', () => {
    const map: TerrainMap = { resolution: 'half-cell', width: 3, height: 1, typeIds: [GRASS, WATER, GRASS] };
    const { sim, request } = mappedSim(map);
    const e = request(sim.terrain?.nodeAt(0, 0) as number, sim.terrain?.nodeAt(2, 0) as number);
    sim.step();
    // The request is already flagged failed - the system must not re-run it.
    const e2 = request(sim.terrain?.nodeAt(0, 0) as number, sim.terrain?.nodeAt(2, 0) as number);
    sim.step();
    expect(sim.world.get(e, PathRequest).failed).toBe(true);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    // A fresh request still routes (the strip is still walled, so e2 also fails - proves the
    // system is live, just not retrying the stale one).
    expect(sim.world.get(e2, PathRequest).failed).toBe(true);
  });

  it('keeps the live PathFollow when a mid-walk reroute fails (the walker parks on a centre)', () => {
    const map: TerrainMap = { resolution: 'half-cell', width: 3, height: 1, typeIds: [GRASS, WATER, GRASS] };
    const { sim } = mappedSim(map);
    const e = sim.world.create();
    // A walker mid-route whose redirected goal turns out unreachable: the request is flagged, but
    // the OLD route must keep playing out - dropping it froze the walker wherever it stood
    // (possibly on a seam waypoint, off any centre) with a goal nothing would ever service again.
    sim.world.add(e, PathFollow, {
      waypoints: [{ x: fx.fromInt(9), y: fx.fromInt(9), node: sim.terrain?.nodeAt(0, 0) as number }],
      index: 0,
      legTicks: 0,
      legCost: 0,
    });
    sim.world.add(e, PathRequest, {
      start: sim.terrain?.nodeAt(0, 0) as number,
      goal: sim.terrain?.nodeAt(2, 0) as number,
      failed: false,
    });
    sim.step();
    expect(sim.world.get(e, PathRequest).failed).toBe(true); // the planner's signal
    expect(sim.world.has(e, PathFollow)).toBe(true); // the old route survives the failed reroute
  });

  it('treats an out-of-range cell id as no route (no throw)', () => {
    const { sim, request } = mappedSim(grassMap(2, 2));
    const e = request(0, 999); // goal cell id is off the 4-node grid
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.get(e, PathRequest).failed).toBe(true);
    expect(sim.world.has(e, PathFollow)).toBe(false);
  });
});

describe('pathfindingSystem - per-tick search budget', () => {
  it('a formation of cheap local requests drains in ONE tick (the budget is search cost, not a request count)', () => {
    // The crowd case the node budget exists for: forty short routes settle a handful of nodes each,
    // far under the tick budget, so the whole formation starts together instead of in an id-order
    // wave (the old fixed request count spread exactly this over five ticks).
    const { sim, request } = mappedSim(grassMap(2, 1));
    const start = sim.terrain?.nodeAt(0, 0) as number;
    const goal = sim.terrain?.nodeAt(1, 0) as number;
    const entities: Entity[] = [];
    for (let i = 0; i < 40; i++) entities.push(request(start, goal));

    sim.step();
    expect(entities.every((e) => !sim.world.has(e, PathRequest))).toBe(true);
  });

  it('cuts on the node budget lowest ids first, and the overshooting request still completes', () => {
    const { sim, request } = mappedSim(grassMap(2, 1));
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim must have terrain');
    const start = terrain.nodeAt(0, 0) as number;
    const goal = terrain.nodeAt(1, 0) as number;
    const entities: Entity[] = [];
    for (let i = 0; i < 3; i++) entities.push(request(start, goal));
    const ctx: SystemContext = {
      content: testContent(),
      rng: sim.rng,
      tick: 1,
      events: sim.events,
      commands: sim.commands,
      terrain,
    };

    // A 1-node budget is overshot by the very FIRST search - it must still complete (every tick
    // makes progress), and everything after it waits for the next pass.
    drainPathRequests(sim.world, ctx, terrain, 1);
    const served = entities.filter((e) => !sim.world.has(e, PathRequest));
    expect(served).toEqual([entities[0]]); // exactly the lowest id

    drainPathRequests(sim.world, ctx, terrain, 1);
    const servedAfterSecond = entities.filter((e) => !sim.world.has(e, PathRequest));
    expect(servedAfterSecond).toEqual([entities[0], entities[1]]); // the next lowest follows

    // A budget comfortably above the remaining work drains the rest in one pass.
    drainPathRequests(sim.world, ctx, terrain, 1024);
    expect(entities.every((e) => !sim.world.has(e, PathRequest))).toBe(true);
  });
});

describe('pathfindingSystem - mid-walk reroute', () => {
  /** Route a fresh walker at (0,0) toward node (goalHx,0) and run `ticks` - mid-leg after. */
  function cruisingWalker(sim: Simulation, goalHx: number, ticks: number): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, PathRequest, {
      start: sim.terrain?.nodeAt(0, 0) as number,
      goal: sim.terrain?.nodeAt(goalHx, 0) as number,
      failed: false,
    });
    for (let i = 0; i < ticks; i++) sim.step();
    return e;
  }

  /** Re-request from the walker's CURRENT node - a player redirect mid-walk. */
  function reorder(sim: Simulation, e: Entity, goalHx: number): void {
    const p = sim.world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    sim.world.add(e, PathRequest, {
      start: sim.terrain?.nodeAtClamped(n.hx, n.hy) as number,
      goal: sim.terrain?.nodeAt(goalHx, 0) as number,
      failed: false,
    });
  }

  it('a same-direction re-order replaces the route and keeps walking on', () => {
    const { sim } = mappedSim(grassMap(20, 1));
    const e = cruisingWalker(sim, 8, 10); // walking east, mid-leg (a step is 8 ticks)
    const before = sim.world.get(e, Position).x;

    reorder(sim, e, 16); // further along the SAME heading
    sim.step();
    const pf = sim.world.get(e, PathFollow);
    expect(pf.waypoints[pf.waypoints.length - 1]?.node).toBe(sim.terrain?.nodeAt(16, 0));
    expect(pf.index).toBe(1); // the fresh route's first leg, from where the walker stands
    expect(sim.world.get(e, Position).x).toBeGreaterThan(before);
  });

  it('a reversal re-order turns the walker back at once, at its ordinary pace', () => {
    const { sim } = mappedSim(grassMap(20, 1));
    const e = cruisingWalker(sim, 16, 22); // genuinely mid-leg: 22 is not a multiple of the 8-tick step
    const before = sim.world.get(e, Position).x;

    reorder(sim, e, 0); // flip: back west
    sim.step();
    const pf = sim.world.get(e, PathFollow);
    expect(pf.waypoints[pf.waypoints.length - 1]?.node).toBe(sim.terrain?.nodeAt(0, 0));
    expect(sim.world.get(e, Position).x).toBeLessThan(before); // and it did move back
  });
});

describe('pathfindingSystem - mapless no-op', () => {
  it('does nothing when the sim has no terrain graph', () => {
    const sim = new Simulation({ seed: 1, content: testContent() }); // mapless
    expect(sim.terrain).toBeUndefined();
    const e = sim.world.create();
    sim.world.add(e, PathRequest, { start: 0, goal: 5, failed: false });
    sim.step();
    // Untouched: no path written, request not flagged (there is no graph to fail against).
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.get(e, PathRequest).failed).toBe(false);
  });

  it('no-ops when invoked directly with a terrain-less context', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = sim.world.create();
    sim.world.add(e, PathRequest, { start: 0, goal: 1, failed: false });
    const ctx: SystemContext = {
      content: testContent(),
      rng: sim.rng,
      tick: 0,
      events: sim.events,
      commands: sim.commands,
    };
    expect(() => pathfindingSystem(sim.world, ctx)).not.toThrow();
    expect(sim.world.get(e, PathRequest).failed).toBe(false);
  });
});

describe('pathfindingSystem - runs inside the real schedule before movement', () => {
  it('a pos-bearing entity gets its PathFollow populated by a normal step()', () => {
    const { sim, request } = mappedSim(grassMap(3, 1));
    const e = request(sim.terrain?.nodeAt(0, 0) as number, sim.terrain?.nodeAt(2, 0) as number);
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.step();
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(sim.world.get(e, PathFollow).waypoints.length).toBe(3);
  });
});
