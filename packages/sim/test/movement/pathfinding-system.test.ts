import { describe, expect, it } from 'vitest';
import {
  addPerson,
  MoveStepPeriod,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  PlayerOrder,
  Position,
  WalkFacing,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  findPath,
  fx,
  nodeOfPosition,
  ONE,
  positionOfNode,
  restoreSimulation,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { worldDistance } from '../../src/nav/world-metric.js';
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
    expect(sim.world.get(e, PathRoute).waypoints).toEqual([
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
    expect(sim.world.get(e, PathRoute).waypoints).toEqual([{ x: Q(1), y: Q(2), node: c }]);
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
    expect(sim.world.get(e, PathRoute).waypoints).toEqual([
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
    expect(sim.world.get(e, PathRoute).waypoints).toEqual([
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
    expect(sim.world.get(e, PathRoute).waypoints.map((w) => w.node)).toEqual([
      sim.terrain?.nodeAt(3, 0),
      sim.terrain?.nodeAt(2, 1),
      sim.terrain?.nodeAt(2, 2),
    ]);
    const f = request(sim.terrain?.nodeAt(2, 1) as number, sim.terrain?.nodeAt(1, 3) as number);
    sim.step();
    expect(sim.world.get(f, PathRoute).waypoints.map((w) => w.node)).toEqual([
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
    if (sim.terrain === undefined) throw new Error('mapped sim expected');
    // A walker mid-route whose redirected goal turns out unreachable: the request is flagged, but
    // the OLD route must keep playing out - dropping it froze the walker wherever it stood
    // (possibly on a seam waypoint, off any centre) with a goal nothing would ever service again.
    sim.world.add(e, PathRoute, {
      waypoints: [{ x: fx.fromInt(9), y: fx.fromInt(9), node: sim.terrain.nodeAt(0, 0) }],
    });
    sim.world.add(e, PathFollow, { index: 0, legTicks: 0, legCost: 0 });
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

describe('pathfindingSystem - a group move shares one route', () => {
  const SOLDIER = 31;
  const P0 = 0;
  const MEMBERS = 8;
  const WIDTH = 160;
  const HEIGHT = 60;
  const WALL_HX = 80;
  const GAP_HY = 54;

  /** Open grass with a water wall at `WALL_HX` down to a gap at `GAP_HY`, so the search floods the
   *  wall's near side before it finds the way round: a march's expensive corridor. */
  function walledMap(): TerrainMap {
    const typeIds = new Array<number>(WIDTH * HEIGHT).fill(GRASS);
    for (let hy = 0; hy < GAP_HY; hy++) typeIds[hy * WIDTH + WALL_HX] = WATER;
    return { resolution: 'half-cell', width: WIDTH, height: HEIGHT, typeIds };
  }

  /** `MEMBERS` owned soldiers packed at the west end, each ordered onto its own spot at the east end. */
  function march(
    ordered: boolean,
    size = MEMBERS,
  ): {
    sim: Simulation;
    ctx: SystemContext;
    members: Entity[];
    soloCost: number;
  } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: walledMap() });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const members: Entity[] = [];
    for (let i = 0; i < size; i++) {
      const start = terrain.nodeAt(8 + (i % 4) * 2, 10 + Math.floor(i / 4) * 2);
      const goal = terrain.nodeAt(150 + (i % 4) * 2, 10 + Math.floor(i / 4) * 2);
      const e = sim.world.create();
      const c = terrain.coordsOf(start);
      sim.world.add(e, Position, positionOfNode(c.x, c.y));
      addPerson(sim.world, e, {
        tribe: 1,
        jobType: SOLDIER,
        hunger: fx.fromInt(0),
        fatigue: fx.fromInt(0),
        piety: fx.fromInt(0),
        enjoyment: fx.fromInt(0),
      });
      sim.world.add(e, Owner, { player: P0 });
      if (ordered) sim.world.add(e, PlayerOrder, {});
      sim.world.add(e, PathRequest, { start, goal, failed: false });
      members.push(e);
    }
    const [lead] = members;
    if (lead === undefined) throw new Error('a march has members');
    const first = sim.world.get(lead, PathRequest);
    const solo = { explored: 0 };
    findPath(terrain, first.start, first.goal, undefined, solo);
    const ctx: SystemContext = {
      content: testContent(),
      rng: sim.rng,
      tick: 1,
      events: sim.events,
      commands: sim.commands,
      terrain,
    };
    return { sim, ctx, members, soloCost: solo.explored };
  }

  it('starts every member of an ordered march in one drain, each on its own spot', () => {
    const { sim, ctx, members, soloCost } = march(true);
    const terrain = ctx.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const requests = members.map((e) => ({ ...sim.world.get(e, PathRequest) }));
    // Two full searches' worth: separate searches would spill six members into later ticks.
    drainPathRequests(sim.world, ctx, terrain, 2 * soloCost);

    members.forEach((e, i) => {
      expect(sim.world.has(e, PathRequest)).toBe(false);
      const nodes = sim.world.get(e, PathRoute).waypoints.map((w) => w.node);
      expect(nodes[0]).toBe(requests[i]?.start);
      expect(nodes[nodes.length - 1]).toBe(requests[i]?.goal); // the formation keeps its spots
    });
    // The lowest id routes in full, exactly as alone.
    const alone = march(true, 1);
    const [lead] = members;
    const [soloLead] = alone.members;
    if (lead === undefined || soloLead === undefined || alone.ctx.terrain === undefined) {
      throw new Error('a march has members');
    }
    drainPathRequests(alone.sim.world, alone.ctx, alone.ctx.terrain, soloCost);
    expect(sim.world.get(lead, PathRoute).waypoints).toEqual(
      alone.sim.world.get(soloLead, PathRoute).waypoints,
    );
  });

  it('starts the whole march in one drain even when the first route alone spends the budget', () => {
    const { sim, ctx, members } = march(true);
    const terrain = ctx.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    drainPathRequests(sim.world, ctx, terrain, 1);
    expect(members.filter((e) => sim.world.has(e, PathRequest))).toEqual([]);
  });

  it('routes economy walks one by one, so the same crowd spills past the budget', () => {
    const { sim, ctx, members, soloCost } = march(false);
    const terrain = ctx.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    drainPathRequests(sim.world, ctx, terrain, 2 * soloCost);
    expect(members.filter((e) => !sim.world.has(e, PathRequest)).length).toBeLessThan(MEMBERS);
  });
});

describe('pathfindingSystem - mid-walk reroute', () => {
  it('stops a held turn at the current node without inventing a new heading', () => {
    const { sim } = mappedSim(grassMap(4, 2));
    const e = cruisingWalker(sim, 2, 1);
    const position = { ...sim.world.get(e, Position) };
    const facing = { ...sim.world.get(e, WalkFacing) };
    expect(sim.world.get(e, PathFollow).legTicks).toBe(0);

    reorder(sim, e, 0);
    sim.step();

    expect(sim.world.get(e, Position)).toEqual(position);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.get(e, WalkFacing)).toEqual(facing);
  });

  it('retains the ordinary pace when the goal changes every tick partway through one step', () => {
    const { sim } = mappedSim(grassMap(20, 1));
    const e = cruisingWalker(sim, 8, 5);
    const pace = fx.div(fx.fromFloat(0.5), fx.fromInt(8));
    for (let i = 0; i < 3; i++) {
      const before = { ...sim.world.get(e, Position) };
      reorder(sim, e, i % 2 === 0 ? 12 : 11);
      sim.step();
      const after = sim.world.get(e, Position);
      expect(Math.abs(worldDistance(before.x, before.y, after.x, after.y) - pace)).toBeLessThanOrEqual(2);
    }
  });

  it('retains a periodic animal step through two redirects toward an ahead node', () => {
    const { sim } = mappedSim(grassMap(10, 1));
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, MoveStepPeriod, { ticks: 8 });
    sim.world.add(e, PathRequest, {
      start: terrain.nodeAt(0, 0),
      goal: terrain.nodeAt(8, 0),
      failed: false,
    });
    sim.run(5);
    for (let i = 0; i < 2; i++) {
      sim.world.add(e, PathRequest, {
        start: terrain.nodeAt(1, 0),
        goal: terrain.nodeAt(7 + i, 0),
        failed: false,
      });
      sim.step();
      const stops = sim.world.get(e, PathRoute).waypoints;
      expect(stops[sim.world.get(e, PathFollow).index]?.node).toBe(terrain.nodeAt(1, 0));
      expect(sim.world.get(e, Position).x).toBe(fx.fromFloat((6 + i) / 16));
    }
    sim.step();
    expect(sim.world.get(e, Position).x).toBe(fx.fromFloat(0.5));
    sim.run(8);
    expect(sim.world.get(e, Position).x).toBe(fx.fromInt(1));
  });

  it('restores the captured pace and charged departure after a mid-step reroute', () => {
    const map = grassMap(20, 1);
    const content = testContent();
    const sim = new Simulation({ seed: 1, content, map });
    const e = cruisingWalker(sim, 8, 5);
    reorder(sim, e, 12);
    sim.step();
    expect(sim.world.get(e, PathFollow).legPace).toBeDefined();
    const restored = restoreSimulation(exportSaveGame(sim, { mapId: 'movement-reroute' }), { content, map });
    sim.run(12);
    restored.run(12);
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('a redirect during a turn uses the new edge length over the already paid step period', () => {
    const { sim } = mappedSim(grassMap(4, 4));
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, WalkFacing, { direction: 3, target: 3 }); // west, about to turn east
    sim.world.add(e, PathRequest, {
      start: sim.terrain?.nodeAt(0, 0) as number,
      goal: sim.terrain?.nodeAt(2, 0) as number,
      failed: false,
    });
    sim.step();
    expect(sim.world.get(e, Position).y).toBe(0);
    expect(sim.world.get(e, PathFollow).legTicks).toBe(0);
    const beforeRedirect = { ...sim.world.get(e, Position) };
    sim.world.add(e, PathRequest, {
      start: sim.terrain?.nodeAt(0, 0) as number,
      goal: sim.terrain?.nodeAt(0, 1) as number,
      failed: false,
    });
    sim.step();
    expect(sim.world.get(e, PathFollow).legCost).toBe(8);
    expect(sim.world.get(e, PathFollow).legPace).toBeUndefined();
    const afterRedirect = sim.world.get(e, Position);
    let advancingTicks = beforeRedirect.x !== afterRedirect.x || beforeRedirect.y !== afterRedirect.y ? 1 : 0;
    for (let i = 0; i < 20 && sim.world.has(e, PathFollow); i++) {
      const before = { ...sim.world.get(e, Position) };
      sim.step();
      const after = sim.world.get(e, Position);
      if (before.x !== after.x || before.y !== after.y) advancingTicks++;
    }
    expect(advancingTicks).toBe(8);
  });

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
    expect(sim.world.get(e, PathRoute).waypoints.at(-1)?.node).toBe(sim.terrain?.nodeAt(16, 0));
    expect(sim.world.get(e, PathFollow).index).toBe(1); // the fresh route's first leg, from where the walker stands
    expect(sim.world.get(e, Position).x).toBeGreaterThan(before);
  });

  it('a reversal re-order turns before moving back at its ordinary pace', () => {
    const { sim } = mappedSim(grassMap(20, 1));
    const e = cruisingWalker(sim, 16, 22); // genuinely mid-leg: 22 is not a multiple of the 8-tick step
    const before = sim.world.get(e, Position).x;

    reorder(sim, e, 0); // flip: back west
    sim.step();
    expect(sim.world.get(e, PathRoute).waypoints.at(-1)?.node).toBe(sim.terrain?.nodeAt(0, 0));
    sim.run(4); // the heading change occupies its intermediate turn ticks
    expect(sim.world.get(e, Position).x).toBeLessThan(before);
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
    expect(sim.world.get(e, PathRoute).waypoints.length).toBe(3);
  });
});
