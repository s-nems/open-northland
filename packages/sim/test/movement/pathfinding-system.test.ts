import { beforeEach, describe, expect, it } from 'vitest';
import { PathFollow, PathRequest, Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, Simulation, type TerrainMap, fx, nodeOfPosition } from '../../src/index.js';
import {
  ACCEL_TICKS,
  MOVE_SPEED_PER_TICK,
  type SystemContext,
  drainPathRequests,
  pathfindingSystem,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit + integration tests for the PathfindingSystem glue — the seam that drains {@link PathRequest}
 * components, runs A* on `ctx.terrain`, and writes the route into {@link PathFollow}. The fixture's
 * landscape table has typeId 0 = grass (walkable) and 1 = water (not walkable); grids are authored
 * directly at NODE (half-cell) resolution. These pin the request→path handoff, the node-position
 * waypoints (with the odd-row diagonal seam splice), the failure flagging, the per-tick budget, and
 * the mapless no-op.
 */

const GRASS = 0;
const WATER = 1;

/** Exact quarter-tile fixed-point values — node positions land on quarters (ONE % 4 === 0). */
const Q = (n: number): number => (n * ONE) / 4;

// Component stores are module-level singletons, so PathFollow/PathRequest entries from one test's
// (now-discarded) World survive into the next, where a fresh World re-mints the same entity ids.
// Clear the stores this suite touches before each case so membership assertions test only this case.
beforeEach(() => {
  PathFollow.store.clear();
  PathRequest.store.clear();
  Position.store.clear();
});

/** A flat all-grass NODE grid of the given dimensions. */
function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

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

describe('pathfindingSystem — request to PathFollow handoff', () => {
  it('resolves a request into node-position waypoints and clears the request', () => {
    const { sim, request } = mappedSim(grassMap(4, 1));
    const start = sim.terrain?.nodeAt(0, 0) as number;
    const goal = sim.terrain?.nodeAt(3, 0) as number;
    const e = request(start, goal);

    sim.step();

    expect(sim.world.has(e, PathRequest)).toBe(false); // cleared on success
    expect(sim.world.has(e, PathFollow)).toBe(true);
    // Row 0 (even): node hx sits at grid x = hx/2 — half-tile pitch, no stagger.
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([
      { x: Q(0), y: Q(0) },
      { x: Q(2), y: Q(0) },
      { x: Q(4), y: Q(0) },
      { x: Q(6), y: Q(0) },
    ]);
    expect(sim.world.get(e, PathFollow).index).toBe(0);
  });

  it('a start===goal request yields a single-node path at the node position', () => {
    const { sim, request } = mappedSim(grassMap(3, 3));
    const c = sim.terrain?.nodeAt(1, 1) as number;
    const e = request(c, c);
    sim.step();
    // Node (1,1): row ½ (stagger ¼) → grid x = ½ − ¼ = ¼.
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([{ x: Q(1), y: Q(2) }]);
  });

  it('splices a seam waypoint into a diagonal leg that LEAVES AN ODD ROW (the stagger kink)', () => {
    // (2,1) -> (3,3) is a single SE diagonal from odd hy=1: rows ½ → 1½ cross the integer row 1
    // mid-leg, where the stagger wave kinks. The seam sits at the edge midpoint's world x
    // ((2+3)/4 = 1¼ columns) expressed at row 1 (stagger ½): grid x = 1¼ − ½ = ¾.
    const { sim, request } = mappedSim(grassMap(5, 5));
    const e = request(sim.terrain?.nodeAt(2, 1) as number, sim.terrain?.nodeAt(3, 3) as number);
    sim.step();
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([
      { x: Q(3), y: Q(2) }, // node (2,1): 1 − ¼
      { x: Q(3), y: Q(4) }, // the seam at row 1
      { x: Q(5), y: Q(6) }, // node (3,3): 1½ − ¼
    ]);
  });

  it('splices NO seam into a diagonal leg between even rows (no kink inside the leg)', () => {
    // (2,0) -> (3,2): rows 0 → 1, the stagger is linear across the whole interval — two waypoints.
    const { sim, request } = mappedSim(grassMap(5, 5));
    const e = request(sim.terrain?.nodeAt(2, 0) as number, sim.terrain?.nodeAt(3, 2) as number);
    sim.step();
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([
      { x: Q(4), y: Q(0) }, // node (2,0)
      { x: Q(4), y: Q(4) }, // node (3,2): row 1, grid x = 1½ − ½ (odd-row stagger)
    ]);
  });
});

describe('pathfindingSystem — failure handling', () => {
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
    // The request is already flagged failed — the system must not re-run it.
    const e2 = request(sim.terrain?.nodeAt(0, 0) as number, sim.terrain?.nodeAt(2, 0) as number);
    sim.step();
    expect(sim.world.get(e, PathRequest).failed).toBe(true);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    // A fresh request still routes (the strip is still walled, so e2 also fails — proves the
    // system is live, just not retrying the stale one).
    expect(sim.world.get(e2, PathRequest).failed).toBe(true);
  });

  it('keeps the live PathFollow when a mid-walk reroute fails (the walker parks on a centre)', () => {
    const map: TerrainMap = { resolution: 'half-cell', width: 3, height: 1, typeIds: [GRASS, WATER, GRASS] };
    const { sim } = mappedSim(map);
    const e = sim.world.create();
    // A walker mid-route whose redirected goal turns out unreachable: the request is flagged, but
    // the OLD route must keep playing out — dropping it froze the walker wherever it stood
    // (possibly on a seam waypoint, off any centre) with a goal nothing would ever service again.
    sim.world.add(e, PathFollow, {
      waypoints: [{ x: fx.fromInt(9), y: fx.fromInt(9) }],
      index: 0,
      speed: fx.fromInt(0),
      hx: fx.fromInt(0),
      hy: fx.fromInt(0),
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

describe('pathfindingSystem — per-tick search budget', () => {
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

    // A 1-node budget is overshot by the very FIRST search — it must still complete (every tick
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

describe('pathfindingSystem — reroute splice momentum (movement inertia)', () => {
  /** Route a fresh walker at (0,0) toward node (goalHx,0) and run `ticks` — mid-leg at gait after. */
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

  /** Re-request from the walker's CURRENT node — a player redirect mid-walk. */
  function reorder(sim: Simulation, e: Entity, goalHx: number): void {
    const p = sim.world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    sim.world.add(e, PathRequest, {
      start: sim.terrain?.nodeAtClamped(n.hx, n.hy) as number,
      goal: sim.terrain?.nodeAt(goalHx, 0) as number,
      failed: false,
    });
  }

  it('a same-direction re-order keeps full momentum (the responsive splice)', () => {
    const { sim } = mappedSim(grassMap(20, 1));
    const e = cruisingWalker(sim, 8, 8); // cruising east, mid-leg
    expect(sim.world.get(e, PathFollow).speed).toBe(MOVE_SPEED_PER_TICK);

    reorder(sim, e, 16); // further along the SAME heading
    sim.step();
    // The splice projected momentum onto a same-direction heading: nothing shed, no re-ramp. (The
    // mid-leg heading can sit a few ulps over ONE — the isqrt under-read — so the dot lands at or
    // just above ONE and the ramp clamp absorbs the inflation; the gait stays bit-exact.)
    expect(sim.world.get(e, PathFollow).speed).toBe(MOVE_SPEED_PER_TICK);
    expect(fx.toFloat(sim.world.get(e, PathFollow).hx)).toBeCloseTo(1, 3); // still due east
  });

  it('a reversal re-order stops the gait dead and re-accelerates — never a full-speed flip', () => {
    const { sim } = mappedSim(grassMap(20, 1));
    // 22 ticks: past the ramp and two ticks beyond the exact node-3 snap at tick 20 — genuinely
    // mid-leg (a half-cell leg is 6 cruise ticks, so round tick counts often land ON a node now).
    const e = cruisingWalker(sim, 16, 22); // cruising east at full gait, mid-leg
    const before = sim.world.get(e, Position).x;
    expect(sim.world.get(e, PathFollow).speed).toBe(MOVE_SPEED_PER_TICK);

    reorder(sim, e, 0); // flip: back west
    sim.step();
    const pf = sim.world.get(e, PathFollow);
    // The splice projected the eastward momentum onto the westward leg (dot = −1 → dead stop);
    // the tick's movement then ramped one accel step from rest. Before the fix the walker kept
    // the FULL cruise gait through the flip — the floor-slide under rapid direction changes.
    expect(pf.speed).toBe(fx.divCeil(MOVE_SPEED_PER_TICK, fx.fromInt(ACCEL_TICKS)));
    expect(fx.toFloat(pf.hx)).toBeCloseTo(-1, 3); // now due west
    expect(sim.world.get(e, Position).x).toBeLessThan(before); // and it did move back
  });
});

describe('pathfindingSystem — mapless no-op', () => {
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

describe('pathfindingSystem — runs inside the real schedule before movement', () => {
  it('a pos-bearing entity gets its PathFollow populated by a normal step()', () => {
    const { sim, request } = mappedSim(grassMap(3, 1));
    const e = request(sim.terrain?.nodeAt(0, 0) as number, sim.terrain?.nodeAt(2, 0) as number);
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.step();
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(sim.world.get(e, PathFollow).waypoints.length).toBe(3);
  });
});
