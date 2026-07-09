import { beforeEach, describe, expect, it } from 'vitest';
import { MoveGoal, PathFollow, PathRequest, Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, cellAnchorNode, fx, halfCellMapFromCells } from '../../src/index.js';
import { type SystemContext, aiSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit + integration tests for the AISystem's navigation-planner slice — the seam that turns a
 * {@link MoveGoal} on a path-less, request-less entity into a {@link PathRequest}, and removes the
 * goal once the entity has arrived. This closes the intent→request→path→move loop end to end with
 * the real PathfindingSystem + MovementSystem inside a normal `step()`. The fixture's landscape has
 * typeId 0 = grass (walkable), 1 = water (not walkable).
 */

const GRASS = 0;

// Component stores are module-level singletons (see pathfinding-system.test.ts), so clear the stores
// this suite touches before each case to keep membership assertions scoped to the current test.
beforeEach(() => {
  PathFollow.store.clear();
  PathRequest.store.clear();
  Position.store.clear();
  MoveGoal.store.clear();
});

/** An all-grass CELL-resolution strip, upsampled to the 2W×2H half-cell navigation lattice. */
function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

/** The cell id of visual tile (x, y)'s ANCHOR NODE — sim grid coords are half-cell nodes. */
function anchorCell(sim: Simulation, x: number, y: number): number {
  const n = cellAnchorNode(x, y);
  return sim.terrain?.cellAt(n.hx, n.hy) as number;
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
    const goal = anchorCell(sim, 3, 0);
    const e = travellerAt(sim, 0, 0, goal);

    // AISystem runs (issues the request) then PathfindingSystem resolves it within the same step.
    sim.step();

    // The goal is still in flight (the entity hasn't arrived), and a path is now being followed.
    expect(sim.world.has(e, MoveGoal)).toBe(true);
    expect(sim.world.has(e, PathFollow)).toBe(true);
    // Node (0,0) to node (6,0) is seven E-step nodes, one waypoint each (no seams on a straight row).
    expect(sim.world.get(e, PathFollow).waypoints.length).toBe(7);
  });

  it('does not issue a second request while one is already in flight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 0, 0, anchorCell(sim, 3, 0));
    // Pre-seed a live request so the planner sees the entity as already travelling.
    sim.world.add(e, PathRequest, { start: 0, goal: 1, failed: false });
    aiSystem(sim.world, ctxOf(sim));
    // Still the pre-seeded request (start 0, goal 1) — the planner did not overwrite/duplicate it.
    expect(sim.world.get(e, PathRequest).goal).toBe(1);
  });

  it('does not issue a request while a route that ENDS AT THE GOAL is being followed', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 0, 0, anchorCell(sim, 3, 0));
    sim.world.add(e, PathFollow, {
      waypoints: [
        { x: fx.fromInt(1), y: fx.fromInt(0) },
        { x: fx.fromInt(3), y: fx.fromInt(0) }, // destination === the goal centre
      ],
      index: 0,
      speed: fx.fromInt(0),
      hx: fx.fromInt(0),
      hy: fx.fromInt(0),
    });
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, PathRequest)).toBe(false);
  });

  it('re-routes IMMEDIATELY when the followed route no longer ends at the goal (a mid-walk redirect)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 0, 0, anchorCell(sim, 3, 0));
    sim.world.add(e, PathFollow, {
      waypoints: [{ x: fx.fromInt(1), y: fx.fromInt(0) }], // a stale route to somewhere else
      index: 0,
      speed: fx.fromInt(0),
      hx: fx.fromInt(0),
      hy: fx.fromInt(0),
    });
    aiSystem(sim.world, ctxOf(sim));
    // A fresh request is issued right away; the stale path keeps the walker moving until the
    // routing splice replaces it (carrying its momentum through the turn — movement inertia).
    expect(sim.world.has(e, PathRequest)).toBe(true);
    expect(sim.world.get(e, PathRequest).goal).toBe(anchorCell(sim, 3, 0));
    expect(sim.world.has(e, PathFollow)).toBe(true);
  });

  it('routes from the NEAREST node centre, not the truncated one, when the walker is mid-leg', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 0, 0, anchorCell(sim, 0, 0));
    // Past the midpoint between nodes (5,0) and (6,0) — the nearest node is (6,0) AHEAD (cell (3,0)'s
    // anchor), truncation says (5,0) behind. Routing from behind made a redirected walker visibly
    // backtrack through that node.
    sim.world.get(e, Position).x = fx.fromFloat(2.8);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, PathRequest).start).toBe(anchorCell(sim, 3, 0));
  });

  it('routes from a walkable bracket node when the NEAREST node is impassable (mid-seam redirect)', () => {
    // A diagonal (±1,±2) leg is legal with one impassable flank (terrain.ts steps), so a walker
    // part-way along it can sit nearest a WATER node. findPath rejects an unwalkable start outright —
    // routing from that node would fail the request and strand the walker mid-leg; the planner must
    // skip to the nearest walkable bracket node instead. Node-level water needs a hand-authored
    // half-cell map (a cell fixture stamps uniform 2×2 blocks).
    const WATER = 1;
    const typeIds = new Array(16).fill(GRASS);
    typeIds[1 * 4 + 2] = WATER; // node (2,1) — a flank of the diagonal leg (1,0) -> (2,2)
    const sim = new Simulation({
      seed: 1,
      content: testContent(),
      map: { resolution: 'half-cell', width: 4, height: 4, typeIds },
    });
    const e = travellerAt(sim, 0, 0, sim.terrain?.cellAt(0, 0) as number);
    // Part-way along the diagonal leg (1,0) -> (2,2): world (0.85, 0.7) — nearest bracket node is
    // the water flank (2,1); the walkable (2,2) must win instead.
    sim.world.get(e, Position).x = fx.fromFloat(0.5);
    sim.world.get(e, Position).y = fx.fromFloat(0.7);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, PathRequest).start).toBe(sim.terrain?.cellAt(2, 2) as number);
    expect(sim.world.get(e, PathRequest).failed).toBe(false);
  });

  it('centres a walker parked off-centre inside the goal cell instead of satisfying the goal early', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const goal = anchorCell(sim, 2, 0);
    const e = travellerAt(sim, 0, 0, goal);
    sim.world.get(e, Position).x = fx.fromFloat(2.2); // in the goal cell, but off its centre
    sim.step(); // plan (single-cell route) + resolve + walk toward the centre
    expect(sim.world.has(e, MoveGoal)).toBe(true); // not yet satisfied — still centring
    for (let t = 0; t < 20 && sim.world.has(e, MoveGoal); t++) sim.step();
    expect(sim.world.has(e, MoveGoal)).toBe(false); // satisfied ON the centre
    expect(pos(sim, e)).toEqual({ x: 2, y: 0 }); // parked exactly on the goal centre
  });

  it('removes a goal the entity already stands on (nothing to do)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const e = travellerAt(sim, 2, 0, anchorCell(sim, 2, 0)); // start === goal node
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
    const goal = anchorCell(sim, 3, 0);
    const e = travellerAt(sim, 0, 0, goal);

    // 3 tiles ≈ 38 ticks with the gait ramp (13 accelerating + 12 cruise + 13 braking), +1 to
    // consume the start waypoint, + the goal→request→path schedule latency; +a little slack.
    // The goal is removed only when the entity is path-less AND standing on the goal cell, so run
    // until that settles.
    let arrived = false;
    for (let i = 0; i < 60 && !arrived; i++) {
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
    const e = travellerAt(sim, 0, 0, anchorCell(sim, 1, 0));
    for (let i = 0; i < 25; i++) sim.step(); // a one-cell trip is 15 ticks + schedule latency
    expect(sim.world.has(e, MoveGoal)).toBe(false); // first goal satisfied
    // A fresh goal sends it onward.
    sim.world.add(e, MoveGoal, { cell: anchorCell(sim, 3, 0) });
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
      travellerAt(s, 0, 0, anchorCell(s, 4, 0));
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
