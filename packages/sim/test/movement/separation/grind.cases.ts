import { describe, expect, it } from 'vitest';
import {
  MoveGoal,
  Obstructed,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  WALK_DIRECTION,
  WalkFacing,
} from '../../../src/components/index.js';
import { fx } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation } from '../../../src/index.js';
import { drainPathRequests, dropPath, pathfindingSystem } from '../../../src/systems/index.js';
import {
  OBSTRUCTED_MAX_REROUTES,
  OBSTRUCTED_REROUTE_TICKS,
  updateObstruction,
} from '../../../src/systems/movement/collision/separation/obstruction.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { GRASS, nodeOf, orderTo, P0, P1, SOLDIER, settlerAt, sim, WATER, wallAt } from './support.js';

const FIRM = true;
const NOT_GHOST = false;
const FIRM_NEAR = true;
/** A tick budget already spent, so only a group member could still start a route. */
const SPENT_BUDGET = 0;
/** Ticks a fresh walk runs before the restart test shoves it: past its turn, partway along a leg. */
const LEG_TICKS_IN = 5;
/** A facing away from an eastward leg, which a restarted leg must turn out of. */
const TURNED_AWAY = WALK_DIRECTION.W;

/** A grind driven by hand: the crowd holds `runner` where it stands, facing its leg, the grind window runs
 *  after each pass and the pathfinder serves what it asks. Returns the ticks it asked on and the tick it
 *  stood down. */
function wedge(s: Simulation, runner: Entity, ticks: number): { asks: number[]; stoodDown: number | null } {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  const held = { ...s.world.get(runner, Position) };
  const asks: number[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    const at = s.world.mut(runner, Position);
    at.x = held.x;
    at.y = held.y;
    const facing = s.world.mut(runner, WalkFacing);
    facing.direction = facing.target;
    updateObstruction(s.world, terrain, runner, FIRM, NOT_GHOST, FIRM_NEAR);
    if (!s.world.has(runner, MoveGoal)) return { asks, stoodDown: tick };
    if (s.world.tryGet(runner, PathRequest)?.grind === true) asks.push(tick);
    pathfindingSystem(s.world, ctxOf(s));
  }
  return { asks, stoodDown: null };
}

/** A water map with a grass corridor `rows` cells high along its middle. */
function corridorSim(widthCells: number, rows: number): Simulation {
  const heightCells = rows + 2;
  const typeIds = new Array<number>(widthCells * heightCells).fill(WATER);
  for (let row = 1; row <= rows; row++) typeIds.fill(GRASS, row * widthCells, (row + 1) * widthCells);
  return new Simulation({
    seed: 1,
    content: testContent(),
    map: halfCellMapFromCells({ width: widthCells, height: heightCells, typeIds }),
  });
}

describe('unit body collision - grind reroutes', () => {
  it('a wedged fighter keeps its route and waits before asking for the same one again', () => {
    const s = sim();
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.step();

    const { asks, stoodDown } = wedge(s, runner, OBSTRUCTED_REROUTE_TICKS * (OBSTRUCTED_MAX_REROUTES + 2));

    // Four windows, the first two answered alike: the second ask waits one window, the third would wait
    // three and the stand-down comes first, on the tick it always did.
    expect(asks).toEqual([OBSTRUCTED_REROUTE_TICKS, 3 * OBSTRUCTED_REROUTE_TICKS]);
    expect(stoodDown).toBe(OBSTRUCTED_REROUTE_TICKS * (OBSTRUCTED_MAX_REROUTES + 1));
    expect(s.world.has(runner, PathFollow)).toBe(false);
    expect(s.world.has(runner, Obstructed)).toBe(false);
  });

  it('keeps the very route it walks while the answers match', () => {
    const s = sim();
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.step();
    const route = s.world.get(runner, PathRoute).waypoints;

    wedge(s, runner, OBSTRUCTED_REROUTE_TICKS * OBSTRUCTED_MAX_REROUTES);

    expect(s.world.get(runner, PathRoute).waypoints).toBe(route);
    expect(s.world.get(runner, Obstructed).hold).toBeGreaterThan(0);
  });

  it('takes a different route at once, with no wait', () => {
    const s = sim();
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.step();
    const route = s.world.get(runner, PathRoute).waypoints;
    // A post standing on the route ahead from the first window on: the reroute finds a flank.
    const blocked = s.terrain?.nodeAt(14, 6);
    expect(route.some((stop) => stop.node === blocked)).toBe(true);
    settlerAt(s, 14, 6, SOLDIER, P1);

    const { asks } = wedge(s, runner, OBSTRUCTED_REROUTE_TICKS);

    expect(asks).toEqual([OBSTRUCTED_REROUTE_TICKS]);
    const taken = s.world.get(runner, PathRoute).waypoints;
    expect(taken).not.toBe(route);
    expect(taken.some((stop) => stop.node === blocked)).toBe(false);
    expect(s.world.get(runner, Obstructed).hold).toBe(0);
  });

  it('drops the route and fails the request when no route is left', () => {
    const s = sim();
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.step();
    wallAt(s, 10, P1); // a standing line seals the far side from the first window on

    const { asks } = wedge(s, runner, OBSTRUCTED_REROUTE_TICKS);

    expect(asks).toEqual([OBSTRUCTED_REROUTE_TICKS]);
    expect(s.world.has(runner, PathFollow)).toBe(false);
    expect(s.world.get(runner, PathRequest).failed).toBe(true);
  });

  it('walks its live route while the ask waits past the tick budget', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.step();
    const route = s.world.get(runner, PathRoute).waypoints;
    const facing = s.world.mut(runner, WalkFacing);
    facing.direction = facing.target;
    for (let tick = 0; tick < OBSTRUCTED_REROUTE_TICKS; tick++) {
      updateObstruction(s.world, terrain, runner, FIRM, NOT_GHOST, FIRM_NEAR);
    }
    expect(s.world.get(runner, PathRequest).grind).toBe(true);

    drainPathRequests(s.world, ctxOf(s), terrain, SPENT_BUDGET);

    expect(s.world.get(runner, PathRoute).waypoints).toBe(route);
    expect(s.world.get(runner, PathRequest).grind).toBe(true);
  });

  it('drops a waiting ask once the walker has moved on, keeping its route', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.step();
    const route = s.world.get(runner, PathRoute).waypoints;
    const facing = s.world.mut(runner, WalkFacing);
    facing.direction = facing.target;
    for (let tick = 0; tick < OBSTRUCTED_REROUTE_TICKS; tick++) {
      updateObstruction(s.world, terrain, runner, FIRM, NOT_GHOST, FIRM_NEAR);
    }
    drainPathRequests(s.world, ctxOf(s), terrain, SPENT_BUDGET);
    // The crowd gives way while the ask waits: the walker passes a stop and is midway on its next leg.
    const passed = s.world.get(runner, PathFollow).index;
    const from = route[passed];
    const to = route[passed + 1];
    if (from === undefined || to === undefined) throw new Error('a route of several legs expected');
    const at = s.world.mut(runner, Position);
    at.x = fx.div(fx.add(from.x, to.x), fx.fromInt(2));
    at.y = fx.div(fx.add(from.y, to.y), fx.fromInt(2));
    s.world.mut(runner, PathFollow).index = passed + 1;

    pathfindingSystem(s.world, ctxOf(s));

    expect(s.world.has(runner, PathRequest)).toBe(false);
    expect(s.world.get(runner, PathRoute).waypoints).toBe(route);
    expect(s.world.get(runner, PathFollow).index).toBe(passed + 1);
  });

  it('restarts a held leg exactly as a fresh install of the same route would', () => {
    const play = (keep: boolean): Simulation => {
      const s = sim();
      const runner = settlerAt(s, 4, 6, SOLDIER, P0);
      orderTo(s, runner, 16, 6);
      s.run(LEG_TICKS_IN);
      const follow = s.world.get(runner, PathFollow);
      const start = s.world.get(runner, PathRoute).waypoints[follow.index - 1]?.node;
      const goal = s.world.get(runner, MoveGoal).cell;
      if (start === undefined) throw new Error('a walker on a leg expected');
      // Shoved round mid-leg: the restarted leg has to turn back toward its stop.
      s.world.mut(runner, WalkFacing).direction = TURNED_AWAY;
      if (!keep) dropPath(s.world, runner);
      s.world.add(runner, PathRequest, { start, goal, failed: false, ...(keep ? { grind: true } : {}) });
      pathfindingSystem(s.world, ctxOf(s));
      return s;
    };
    const held = play(true);
    const fresh = play(false);
    const runnerOf = (s: Simulation): Entity => s.world.canonicalQuery(PathFollow)[0] as Entity;
    const legOf = (s: Simulation) => {
      const { index, bootsDegree, ...leg } = s.world.get(runnerOf(s), PathFollow);
      void bootsDegree;
      return { leg, stop: s.world.get(runnerOf(s), PathRoute).waypoints[index] };
    };

    expect(held.world.has(runnerOf(held), PathRequest)).toBe(false);
    expect(legOf(held)).toEqual(legOf(fresh));
    expect(held.world.get(runnerOf(held), WalkFacing)).toEqual(fresh.world.get(runnerOf(fresh), WalkFacing));
    for (let tick = 0; tick < LEG_TICKS_IN; tick++) {
      held.step();
      fresh.step();
      expect(held.world.get(runnerOf(held), Position)).toEqual(fresh.world.get(runnerOf(fresh), Position));
      expect(held.world.get(runnerOf(held), WalkFacing)).toEqual(
        fresh.world.get(runnerOf(fresh), WalkFacing),
      );
    }
  });

  it('two groups crossing a corridor all arrive no later than before', () => {
    /** The tick the last walker arrived when every grind reroute dropped its route and asked again. */
    const ARRIVED_BY = 147;
    const s = corridorSim(16, 2);
    const rows = [2, 3, 4, 5];
    const walkers = new Map<Entity, { x: number; y: number }>();
    for (const y of rows) {
      const east = settlerAt(s, 8, y, SOLDIER, P0);
      orderTo(s, east, 26, y);
      walkers.set(east, { x: 26, y });
      const west = settlerAt(s, 23, y, SOLDIER, P0);
      orderTo(s, west, 5, y);
      walkers.set(west, { x: 5, y });
    }
    s.run(ARRIVED_BY);

    for (const [e, goal] of walkers) {
      expect(nodeOf(s, e)).toEqual(goal);
      expect(s.world.has(e, MoveGoal)).toBe(false);
    }
  });
});
