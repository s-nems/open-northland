import { describe, expect, it } from 'vitest';
import {
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  Stranded,
} from '../../src/components/index.js';
import { positionOfNode, Simulation, type TerrainMap } from '../../src/index.js';
import { hexDistance } from '../../src/nav/halfcell.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import { invalidateLandscapeRoutes } from '../../src/systems/landscape/routes.js';
import type { MissionPass } from '../../src/systems/missions/pass.js';
import { setRandomChest } from '../../src/systems/missions/results/chests.js';
import { editScriptedLandscape, settleLandscapePass } from '../../src/systems/missions/results/landscape.js';
import { ctxOf } from '../fixtures/context.js';
import { stopAt } from '../fixtures/waypoints.js';
import { fresh, map, POINT, terrainOf, WALL } from './landscape-support.js';
import { houseContent } from './support.js';

function passOf(sim: Simulation): MissionPass {
  return {
    world: sim.world,
    ctx: ctxOf(sim),
    script: { missions: [] },
    records: [],
    tick: 0,
    report: () => {},
    reportFailed: () => {},
    checking: new Set(),
    halted: false,
  };
}

const WOODEN_CHEST = 85;
/** The random-chest mask bit that always draws the tower chest. */
const TOWER_CHEST_MASK = 2;

/** The landscape fixture with a one-cell wooden chest type beside its wall. */
function chestSim(): Simulation {
  const base = map();
  if (base.landscapes === undefined) throw new Error('landscape fixture');
  const withChest: TerrainMap = {
    ...base,
    landscapes: {
      ...base.landscapes,
      types: [
        ...base.landscapes.types,
        {
          typeId: WOODEN_CHEST,
          walk: [{ dx: 0, dy: 0 }],
          build: [{ dx: 0, dy: 0 }],
          groups: [],
          chest: { kind: 'wooden', gfxIndex: 845 },
        },
      ],
    },
  };
  return new Simulation({ seed: 1, content: houseContent(), map: withChest });
}

/** A walker on its route from (4,4) to (5,6). */
function walking(sim: Simulation) {
  const terrain = terrainOf(sim);
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(4, 4));
  sim.world.add(e, MoveGoal, { cell: terrain.nodeAt(5, 6) });
  sim.world.add(e, PathRoute, { waypoints: [stopAt(terrain, 5, 6)] });
  sim.world.add(e, PathFollow, { index: 0, legTicks: 0, legCost: 0 });
  return e;
}

describe('script landscape route invalidation', () => {
  it('queues a replacement for an in-flight path crossing a new script blocker', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(4, 8));
    sim.world.add(e, MoveGoal, { cell: terrain.nodeAt(12, 8) });
    sim.world.add(e, PathRoute, { waypoints: [stopAt(terrain, 8, 8), stopAt(terrain, 12, 8)] });
    sim.world.add(e, PathFollow, { index: 0, legTicks: 0, legCost: 0 });
    invalidateLandscapeRoutes(sim.world, terrain);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.get(e, PathRequest)).toEqual({
      start: terrain.nodeAt(4, 8),
      goal: terrain.nodeAt(12, 8),
      failed: false,
    });
  });

  it('requeues a diagonal whose endpoints remain free when its midpoint flanks close', () => {
    const source = map();
    const sim = new Simulation({
      seed: 1,
      content: houseContent(),
      map: {
        ...source,
        landscapes: {
          types: [WALL],
          placements: [{ id: 0, typeId: 1, hx: 4, hy: 5, level: 0 }],
        },
      },
    });
    const terrain = terrainOf(sim);
    const start = terrain.nodeAt(4, 4);
    const goal = terrain.nodeAt(5, 6);
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(4, 4));
    sim.world.add(e, MoveGoal, { cell: goal });
    sim.world.add(e, PathRoute, { waypoints: [stopAt(terrainOf(sim), 5, 6)] });
    sim.world.add(e, PathFollow, { index: 0, legTicks: 0, legCost: 0 });
    const blocked = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
    expect(blocked.has(start)).toBe(false);
    expect(blocked.has(goal)).toBe(false);
    expect(terrain.steps(start, blocked).some((step) => step.node === goal)).toBe(false);
    invalidateLandscapeRoutes(sim.world, terrain);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.get(e, PathRequest)).toEqual({ start, goal, failed: false });
  });

  it('preserves active paths when decoration changes no effective walk blockers', () => {
    const sim = fresh();
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(4, 4));
    sim.world.add(e, MoveGoal, { cell: terrainOf(sim).nodeAt(5, 6) });
    sim.world.add(e, PathRoute, { waypoints: [stopAt(terrainOf(sim), 5, 6)] });
    sim.world.add(e, PathFollow, { index: 0, legTicks: 0, legCost: 0 });
    editScriptedLandscape(passOf(sim), 0, {
      opcode: 'SetLandscape',
      point: { hx: 3, hy: 3 },
      landscape: 2,
      level: 0,
      flag: false,
    });
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(sim.world.has(e, PathRequest)).toBe(false);
    expect(sim.landscapeEdits().added).toHaveLength(1);
    editScriptedLandscape(passOf(sim), 0, {
      opcode: 'SetLandscape',
      point: { hx: 4, hy: 5 },
      landscape: 1,
      level: 0,
      flag: false,
    });
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.has(e, PathRequest)).toBe(true);
  });

  it('keeps active paths when a pass removes a blocker and lays the same shape back', () => {
    // The pressure-plate idiom: every pass removes the plate and sets it again. Nothing a route
    // could cross before the pass is closed after it, so no walker is sent back to the planner.
    const sim = fresh();
    const terrain = terrainOf(sim);
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(4, 4));
    sim.world.add(e, MoveGoal, { cell: terrain.nodeAt(5, 6) });
    sim.world.add(e, PathRoute, { waypoints: [stopAt(terrainOf(sim), 5, 6)] });
    sim.world.add(e, PathFollow, { index: 0, legTicks: 0, legCost: 0 });
    const pass = passOf(sim);
    editScriptedLandscape(pass, 0, { opcode: 'RemoveLandscape', point: POINT });
    editScriptedLandscape(pass, 0, {
      opcode: 'SetLandscape',
      point: POINT,
      landscape: 1,
      level: 0,
      flag: false,
    });
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(9, 8))).toBe(true);
    // The next pass starts afresh: laying the wall one point over closes (10,8), which was open.
    editScriptedLandscape(passOf(sim), 0, {
      opcode: 'SetLandscape',
      point: { hx: 9, hy: 8 },
      landscape: 1,
      level: 0,
      flag: false,
    });
    expect(sim.world.has(e, PathFollow)).toBe(false);
  });

  it('clears the plain area removal one ring short of its range, the group removals not', () => {
    // The fixture has the wall at POINT (id 0) and the smoke placement (id 1) some points away.
    const spacing = hexDistance(POINT, { hx: 5, hy: 5 });
    const short = fresh();
    editScriptedLandscape(passOf(short), 0, {
      opcode: 'RemoveLandscapesInArea',
      point: POINT,
      range: spacing,
    });
    expect(short.landscapeEdits().removed).toEqual([0]);
    const full = fresh();
    editScriptedLandscape(passOf(full), 0, {
      opcode: 'RemoveLandscapesInArea',
      point: POINT,
      range: spacing + 1,
    });
    expect(full.landscapeEdits().removed).toEqual([0, 1]);
    const group = fresh();
    editScriptedLandscape(passOf(group), 0, {
      opcode: 'RemoveFXSmokeLandscapeInArea',
      point: POINT,
      range: spacing,
    });
    expect(group.landscapeEdits().removed).toEqual([1]);
  });

  it.each([
    'RemoveLandscape',
    'RemoveLandscapesInArea',
    'SetHouseBuildForbiddenArea',
    'SetVertexColor',
    'SetVertexColorOnLand',
    'SetLandscape',
  ] as const)('reports off-map %s without mutating the world', (opcode) => {
    const sim = fresh();
    const pass = passOf(sim);
    const failures: string[] = [];
    const version = sim.world.mutationVersion;
    editScriptedLandscape({ ...pass, reportFailed: (_, failed) => failures.push(failed) }, 0, {
      opcode,
      point: { hx: -1, hy: POINT.hy },
      range: 1e9,
      amount: 50,
      flag: true,
      landscape: 1,
      level: 0,
    });
    expect(failures).toEqual([opcode]);
    expect(sim.world.mutationVersion).toBe(version);
  });

  it('keeps active paths when a pass lays a script chest where it removed a blocker', () => {
    // A paid tribute that clears a barricade and leaves chests on its cells: the chest closes nothing
    // a route could cross before the pass.
    const sim = chestSim();
    const terrain = terrainOf(sim);
    const e = walking(sim);
    const pass = passOf(sim);
    editScriptedLandscape(pass, 0, { opcode: 'RemoveLandscape', point: POINT });
    setRandomChest(pass, 0, { opcode: 'SetRandomChestOnPosition', amount: TOWER_CHEST_MASK, point: POINT });
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(POINT.hx, POINT.hy))).toBe(
      true,
    );
    expect(sim.world.has(e, PathFollow)).toBe(true);
  });

  it('sends routes back to the planner when a script chest closes open ground', () => {
    const sim = chestSim();
    const e = walking(sim);
    setRandomChest(passOf(sim), 0, {
      opcode: 'SetRandomChestOnPosition',
      amount: TOWER_CHEST_MASK,
      point: { hx: 5, hy: 5 },
    });
    expect(sim.landscapeEdits().added).toHaveLength(1);
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.has(e, PathRequest)).toBe(true);
  });

  it('lets a stranded settler retry once a pass leaves a cleared cell open, not when it lays it back', () => {
    const sim = chestSim();
    const lost = sim.world.create();
    sim.world.add(lost, Stranded, { retryAt: 1000 });
    // The pressure plate: removed and laid again, so nothing stays open.
    const plate = passOf(sim);
    editScriptedLandscape(plate, 0, { opcode: 'RemoveLandscape', point: POINT });
    editScriptedLandscape(plate, 0, {
      opcode: 'SetLandscape',
      point: POINT,
      landscape: 1,
      level: 0,
      flag: false,
    });
    settleLandscapePass(plate);
    expect(sim.world.has(lost, Stranded)).toBe(true);
    // The tribute: the two-cell wall goes and a one-cell chest takes its point, so a cell stays open.
    const tribute = passOf(sim);
    editScriptedLandscape(tribute, 0, { opcode: 'RemoveLandscape', point: POINT });
    setRandomChest(tribute, 0, {
      opcode: 'SetRandomChestOnPosition',
      amount: TOWER_CHEST_MASK,
      point: POINT,
    });
    settleLandscapePass(tribute);
    expect(sim.world.has(lost, Stranded)).toBe(false);
  });
});
