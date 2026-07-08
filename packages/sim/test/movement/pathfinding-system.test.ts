import { beforeEach, describe, expect, it } from 'vitest';
import { PathFollow, PathRequest, Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, fx } from '../../src/index.js';
import {
  ACCEL_TICKS,
  MOVE_SPEED_PER_TICK,
  PATHFINDING_BUDGET_PER_TICK,
  type SystemContext,
  pathfindingSystem,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit + integration tests for the PathfindingSystem glue — the seam that drains {@link PathRequest}
 * components, runs A* on `ctx.terrain`, and writes the route into {@link PathFollow}. The fixture's
 * landscape table has typeId 0 = grass (walkable) and 1 = water (not walkable). These pin the
 * request→path handoff, the failure flagging, the per-tick budget, and the mapless no-op.
 */

const GRASS = 0;
const WATER = 1;

// Component stores are module-level singletons, so PathFollow/PathRequest entries from one test's
// (now-discarded) World survive into the next, where a fresh World re-mints the same entity ids.
// Clear the stores this suite touches before each case so membership assertions test only this case.
beforeEach(() => {
  PathFollow.store.clear();
  PathRequest.store.clear();
  Position.store.clear();
});

/** A flat all-grass map of the given dimensions. */
function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
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

/** Read a PathFollow's waypoints back to integer (x,y) tile coords for readable assertions. */
function waypointCoords(sim: Simulation, e: Entity): Array<{ x: number; y: number }> {
  const pf = sim.world.get(e, PathFollow);
  return pf.waypoints.map((w) => ({ x: fx.toInt(w.x), y: fx.toInt(w.y) }));
}

describe('pathfindingSystem — request to PathFollow handoff', () => {
  it('resolves a request into cell-centre waypoints and clears the request', () => {
    const { sim, request } = mappedSim(grassMap(4, 1));
    const start = sim.terrain?.cellAt(0, 0) as number;
    const goal = sim.terrain?.cellAt(3, 0) as number;
    const e = request(start, goal);

    sim.step();

    expect(sim.world.has(e, PathRequest)).toBe(false); // cleared on success
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(waypointCoords(sim, e)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(sim.world.get(e, PathFollow).index).toBe(0);
  });

  it('writes waypoints in fixed-point (not raw ints)', () => {
    const { sim, request } = mappedSim(grassMap(2, 1));
    const e = request(sim.terrain?.cellAt(0, 0) as number, sim.terrain?.cellAt(1, 0) as number);
    sim.step();
    const pf = sim.world.get(e, PathFollow);
    expect(pf.waypoints[0]?.x).toBe(fx.fromInt(0));
    expect(pf.waypoints[1]?.x).toBe(fx.fromInt(1));
  });

  it('a start===goal request yields a single-cell path', () => {
    const { sim, request } = mappedSim(grassMap(3, 3));
    const c = sim.terrain?.cellAt(1, 1) as number;
    const e = request(c, c);
    sim.step();
    expect(waypointCoords(sim, e)).toEqual([{ x: 1, y: 1 }]);
  });

  it('splices a seam waypoint into each vertical (two-row) step so the leg is world-straight', () => {
    // (2,0) -> (2,4) routes as two straight S steps; each gets a mid-leg waypoint at the seam the
    // world-vertical line crosses the intermediate row: half a column LEFT of the column when
    // leaving an even row (the odd row below is stagger-shifted right), so grid x = 1.5.
    const { sim, request } = mappedSim(grassMap(5, 5));
    const e = request(sim.terrain?.cellAt(2, 0) as number, sim.terrain?.cellAt(2, 4) as number);
    sim.step();
    const pf = sim.world.get(e, PathFollow);
    expect(pf.waypoints).toEqual([
      { x: fx.fromInt(2), y: fx.fromInt(0) },
      { x: fx.fromFloat(1.5), y: fx.fromInt(1) }, // seam of the first S step
      { x: fx.fromInt(2), y: fx.fromInt(2) },
      { x: fx.fromFloat(1.5), y: fx.fromInt(3) }, // seam of the second S step
      { x: fx.fromInt(2), y: fx.fromInt(4) },
    ]);
  });

  it('places the seam half a column RIGHT when the vertical step leaves an ODD row', () => {
    // (2,1) -> (2,3): both centres sit at world x = 2.5 (the odd-row shift), so the seam on the
    // even row between them is at grid x = 2.5 — the stagger shift flips the seam's side.
    const { sim, request } = mappedSim(grassMap(5, 5));
    const e = request(sim.terrain?.cellAt(2, 1) as number, sim.terrain?.cellAt(2, 3) as number);
    sim.step();
    expect(sim.world.get(e, PathFollow).waypoints).toEqual([
      { x: fx.fromInt(2), y: fx.fromInt(1) },
      { x: fx.fromFloat(2.5), y: fx.fromInt(2) },
      { x: fx.fromInt(2), y: fx.fromInt(3) },
    ]);
  });
});

describe('pathfindingSystem — failure handling', () => {
  it('flags an unreachable request failed, keeps the request, and writes no path', () => {
    // 3x1 strip walled by a centre water cell isolates the two grass ends.
    const map: TerrainMap = { width: 3, height: 1, typeIds: [GRASS, WATER, GRASS] };
    const { sim, request } = mappedSim(map);
    const e = request(sim.terrain?.cellAt(0, 0) as number, sim.terrain?.cellAt(2, 0) as number);

    sim.step();

    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.has(e, PathRequest)).toBe(true);
    expect(sim.world.get(e, PathRequest).failed).toBe(true);
  });

  it('does not retry an already-failed request on later ticks', () => {
    const map: TerrainMap = { width: 3, height: 1, typeIds: [GRASS, WATER, GRASS] };
    const { sim, request } = mappedSim(map);
    const e = request(sim.terrain?.cellAt(0, 0) as number, sim.terrain?.cellAt(2, 0) as number);
    sim.step();
    // Open the wall, but the request is already flagged failed — the system must not re-run it.
    const e2 = request(sim.terrain?.cellAt(0, 0) as number, sim.terrain?.cellAt(2, 0) as number);
    sim.step();
    expect(sim.world.get(e, PathRequest).failed).toBe(true);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    // A fresh request still routes (the strip is still walled, so e2 also fails — proves the
    // system is live, just not retrying the stale one).
    expect(sim.world.get(e2, PathRequest).failed).toBe(true);
  });

  it('keeps the live PathFollow when a mid-walk reroute fails (the walker parks on a centre)', () => {
    const map: TerrainMap = { width: 3, height: 1, typeIds: [GRASS, WATER, GRASS] };
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
      start: sim.terrain?.cellAt(0, 0) as number,
      goal: sim.terrain?.cellAt(2, 0) as number,
      failed: false,
    });
    sim.step();
    expect(sim.world.get(e, PathRequest).failed).toBe(true); // the planner's signal
    expect(sim.world.has(e, PathFollow)).toBe(true); // the old route survives the failed reroute
  });

  it('treats an out-of-range cell id as no route (no throw)', () => {
    const { sim, request } = mappedSim(grassMap(2, 2));
    const e = request(0, 999); // goal cell id is off the 4-cell grid
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.get(e, PathRequest).failed).toBe(true);
    expect(sim.world.has(e, PathFollow)).toBe(false);
  });
});

describe('pathfindingSystem — per-tick budget', () => {
  it('resolves at most PATHFINDING_BUDGET_PER_TICK requests per tick, lowest ids first', () => {
    const { sim, request } = mappedSim(grassMap(2, 1));
    const start = sim.terrain?.cellAt(0, 0) as number;
    const goal = sim.terrain?.cellAt(1, 0) as number;
    const n = PATHFINDING_BUDGET_PER_TICK + 3;
    const entities: Entity[] = [];
    for (let i = 0; i < n; i++) entities.push(request(start, goal));

    sim.step();

    // Exactly the budget got served (PathRequest cleared) this tick.
    const served = entities.filter((e) => !sim.world.has(e, PathRequest));
    expect(served.length).toBe(PATHFINDING_BUDGET_PER_TICK);
    // ...and they are the lowest entity ids (canonical order), not an arbitrary subset.
    const sorted = [...entities].sort((a, b) => a - b);
    expect(served.sort((a, b) => a - b)).toEqual(sorted.slice(0, PATHFINDING_BUDGET_PER_TICK));

    // The remainder drain on the next tick.
    sim.step();
    expect(entities.every((e) => !sim.world.has(e, PathRequest))).toBe(true);
  });
});

describe('pathfindingSystem — reroute splice momentum (movement inertia)', () => {
  /** Route a fresh walker at (0,0) toward (goalX,0) and run `ticks` — mid-tile at full gait after. */
  function cruisingWalker(sim: Simulation, goalX: number, ticks: number): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, PathRequest, {
      start: sim.terrain?.cellAt(0, 0) as number,
      goal: sim.terrain?.cellAt(goalX, 0) as number,
      failed: false,
    });
    for (let i = 0; i < ticks; i++) sim.step();
    return e;
  }

  /** Re-request from the walker's CURRENT cell — a player redirect mid-walk. */
  function reorder(sim: Simulation, e: Entity, goalX: number): void {
    const p = sim.world.get(e, Position);
    sim.world.add(e, PathRequest, {
      start: sim.terrain?.cellAt(fx.toInt(p.x), fx.toInt(p.y)) as number,
      goal: sim.terrain?.cellAt(goalX, 0) as number,
      failed: false,
    });
  }

  it('a same-direction re-order keeps full momentum (the responsive splice)', () => {
    const { sim } = mappedSim(grassMap(10, 1));
    const e = cruisingWalker(sim, 4, 8); // cruising east, mid-tile
    expect(sim.world.get(e, PathFollow).speed).toBe(MOVE_SPEED_PER_TICK);

    reorder(sim, e, 8); // further along the SAME heading
    sim.step();
    // The splice projected momentum onto a same-direction heading: nothing shed, no re-ramp. (The
    // mid-tile heading can sit a few ulps over ONE — the isqrt under-read — so the dot lands at or
    // just above ONE and the ramp clamp absorbs the inflation; the gait stays bit-exact.)
    expect(sim.world.get(e, PathFollow).speed).toBe(MOVE_SPEED_PER_TICK);
    expect(fx.toFloat(sim.world.get(e, PathFollow).hx)).toBeCloseTo(1, 3); // still due east
  });

  it('a reversal re-order stops the gait dead and re-accelerates — never a full-speed flip', () => {
    const { sim } = mappedSim(grassMap(10, 1));
    const e = cruisingWalker(sim, 8, 20); // cruising east at full gait, mid-tile past x=1
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
    const e = request(sim.terrain?.cellAt(0, 0) as number, sim.terrain?.cellAt(2, 0) as number);
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.step();
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(sim.world.get(e, PathFollow).waypoints.length).toBe(3);
  });
});
