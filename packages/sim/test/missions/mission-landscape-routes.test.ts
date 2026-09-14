import { describe, expect, it } from 'vitest';
import { MoveGoal, PathFollow, PathRequest, Position } from '../../src/components/index.js';
import { fx, positionOfNode, Simulation } from '../../src/index.js';
import { hexDistance } from '../../src/nav/halfcell.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import { invalidateLandscapeRoutes } from '../../src/systems/landscape/routes.js';
import type { MissionPass } from '../../src/systems/missions/pass.js';
import { editScriptedLandscape } from '../../src/systems/missions/results/landscape.js';
import { ctxOf } from '../fixtures/context.js';
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

describe('script landscape route invalidation', () => {
  it('queues a replacement for an in-flight path crossing a new script blocker', () => {
    const sim = fresh();
    const terrain = terrainOf(sim);
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(4, 8));
    sim.world.add(e, MoveGoal, { cell: terrain.nodeAt(12, 8) });
    sim.world.add(e, PathFollow, {
      waypoints: [positionOfNode(8, 8), positionOfNode(12, 8)],
      index: 0,
      speed: fx.fromInt(1),
      hx: fx.fromInt(1),
      hy: fx.fromInt(0),
    });
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
    sim.world.add(e, PathFollow, {
      waypoints: [positionOfNode(5, 6)],
      index: 0,
      speed: fx.fromInt(1),
      hx: fx.fromInt(1),
      hy: fx.fromInt(1),
    });
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
    sim.world.add(e, PathFollow, {
      waypoints: [positionOfNode(5, 6)],
      index: 0,
      speed: fx.fromInt(1),
      hx: fx.fromInt(1),
      hy: fx.fromInt(1),
    });
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
});
