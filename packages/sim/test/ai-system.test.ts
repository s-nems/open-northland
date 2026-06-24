import { beforeEach, describe, expect, it } from 'vitest';
import { MoveGoal, PathFollow, PathRequest, Position } from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { Simulation, type TerrainMap, fx } from '../src/index.js';
import { type SystemContext, aiSystem } from '../src/systems/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Unit + integration tests for the AISystem's navigation-planner slice — the seam that turns a
 * {@link MoveGoal} on a path-less, request-less entity into a {@link PathRequest}, and removes the
 * goal once the entity has arrived. This closes the intent→request→path→move loop end to end with
 * the real PathfindingSystem + MovementSystem inside a normal `step()`. The fixture's landscape has
 * typeId 0 = grass (walkable), 1 = water (not walkable).
 */

const GRASS = 0;
const WATER = 1;

// Component stores are module-level singletons (see pathfinding-system.test.ts), so clear the stores
// this suite touches before each case to keep membership assertions scoped to the current test.
beforeEach(() => {
  PathFollow.store.clear();
  PathRequest.store.clear();
  Position.store.clear();
  MoveGoal.store.clear();
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** Place an entity at integer tile (x,y) with a navigation goal to the given cell id. */
function travellerAt(sim: Simulation, x: number, y: number, goalCell: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, MoveGoal, { cell: goalCell });
  return e;
}

function pos(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toFloat(p.x), y: fx.toFloat(p.y) };
}

describe('aiSystem — navigation planner: MoveGoal -> PathRequest', () => {
  it('issues a PathRequest from the entity cell to the goal cell when idle', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const goal = sim.terrain?.cellAt(3, 0) as number;
    const e = travellerAt(sim, 0, 0, goal);

    // AISystem runs (issues the request) then PathfindingSystem resolves it within the same step.
    sim.step();

    // The goal is still in flight (the entity hasn't arrived), and a path is now being followed.
    expect(sim.world.has(e, MoveGoal)).toBe(true);
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(sim.world.get(e, PathFollow).waypoints.length).toBe(4);
  });

  it('does not issue a second request while one is already in flight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 0, 0, sim.terrain?.cellAt(3, 0) as number);
    // Pre-seed a live request so the planner sees the entity as already travelling.
    sim.world.add(e, PathRequest, { start: 0, goal: 1, failed: false });
    aiSystem(sim.world, ctxOf(sim));
    // Still the pre-seeded request (start 0, goal 1) — the planner did not overwrite/duplicate it.
    expect(sim.world.get(e, PathRequest).goal).toBe(1);
  });

  it('does not issue a request while a path is being followed', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 0, 0, sim.terrain?.cellAt(3, 0) as number);
    sim.world.add(e, PathFollow, { waypoints: [{ x: fx.fromInt(0), y: fx.fromInt(0) }], index: 0 });
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, PathRequest)).toBe(false);
  });

  it('removes a goal the entity already stands on (nothing to do)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 2, 0, sim.terrain?.cellAt(2, 0) as number); // start === goal cell
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, MoveGoal)).toBe(false);
    expect(sim.world.has(e, PathRequest)).toBe(false);
  });

  it('drops an off-map goal rather than issuing dead requests forever', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(2, 2) });
    const e = travellerAt(sim, 0, 0, 999); // goal cell id is off the 4-cell grid
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, MoveGoal)).toBe(false);
    expect(sim.world.has(e, PathRequest)).toBe(false);
  });

  it('no-ops on a mapless sim (no cells to navigate over)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(sim.terrain).toBeUndefined();
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, MoveGoal, { cell: 5 });
    sim.step();
    expect(sim.world.has(e, PathRequest)).toBe(false);
    expect(sim.world.has(e, MoveGoal)).toBe(true); // untouched
  });
});

describe('aiSystem — end-to-end: goal to arrival through the real schedule', () => {
  it('walks a settler to its goal cell and clears the goal on arrival', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const goal = sim.terrain?.cellAt(3, 0) as number;
    const e = travellerAt(sim, 0, 0, goal);

    // 3 tiles at 1/4 tile/tick = 12 move-steps; +1 to consume the start waypoint; +a little slack.
    // The goal is removed only when the entity is path-less AND standing on the goal cell, so run
    // until that settles.
    let arrived = false;
    for (let i = 0; i < 30 && !arrived; i++) {
      sim.step();
      arrived = !sim.world.has(e, MoveGoal);
    }

    expect(arrived).toBe(true);
    expect(pos(sim, e).x).toBeCloseTo(3, 6);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.has(e, PathRequest)).toBe(false);
  });

  it('re-issues a request after arriving at the goal cell only if a new goal is set', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 0, 0, sim.terrain?.cellAt(1, 0) as number);
    for (let i = 0; i < 12; i++) sim.step();
    expect(sim.world.has(e, MoveGoal)).toBe(false); // first goal satisfied
    // A fresh goal sends it onward.
    sim.world.add(e, MoveGoal, { cell: sim.terrain?.cellAt(3, 0) as number });
    sim.step();
    expect(sim.world.has(e, PathFollow)).toBe(true);
  });
});

describe('aiSystem — determinism', () => {
  it('two same-seed sims with the same goal reach the same state hash', () => {
    const runOne = (): string => {
      PathFollow.store.clear();
      PathRequest.store.clear();
      Position.store.clear();
      MoveGoal.store.clear();
      const s = new Simulation({ seed: 7, content: testContent(), map: grassMap(5, 1) });
      travellerAt(s, 0, 0, s.terrain?.cellAt(4, 0) as number);
      for (let i = 0; i < 25; i++) s.step();
      return s.hashState();
    };
    expect(runOne()).toBe(runOne());
  });
});

/** A SystemContext for invoking aiSystem directly with the sim's live terrain. */
function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: 0,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}
