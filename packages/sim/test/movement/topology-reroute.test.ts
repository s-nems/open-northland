import { describe, expect, it } from 'vitest';
import {
  addPerson,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
} from '../../src/components/index.js';
import { exportSaveGame, fx, positionOfNode, restoreSimulation, Simulation } from '../../src/index.js';
import { positionXOfWorld } from '../../src/nav/halfcell.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import { dynamicBlockOverlay, stampResourceFootprintData } from '../../src/systems/footprint/index.js';
import { invalidateLandscapeRoutes } from '../../src/systems/landscape/routes.js';
import { pathfindingSystem } from '../../src/systems/movement/routing.js';
import { placePalisade } from '../../src/systems/palisades/index.js';
import { navigationPlanner } from '../../src/systems/settlers/planner/navigation.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

describe('topology reroutes', () => {
  it.each([
    'wall',
    'wall-restored',
    'late-wall',
    'sealed',
    'landscape',
    'sealed-landscape',
    'redirect-sealed',
  ] as const)('reroutes from walkable ground after %s changes beside a diagonal', (change) => {
    const map = grassNodeMap(16, 16);
    const typeIds = [...map.typeIds];
    typeIds[5 * 16 + 4] = 1;
    const options = {
      seed: 1,
      content: testContent(),
      map: {
        ...map,
        typeIds,
        landscapes: {
          placements: [],
          types: [
            {
              typeId: 691,
              walk: [{ dx: 0, dy: 0 }],
              build: [{ dx: 0, dy: 0 }],
              groups: [],
              wall: { maxHitpoints: 100, repairPerStrike: 1, construction: [{ goodType: 5, amount: 1 }] },
            },
          ],
        },
      },
    };
    let sim = new Simulation(options);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected terrain');

    if (change.includes('sealed'))
      for (let x = 0; x < 16; x++) {
        if (x !== 5)
          placePalisade(sim.world, ctxOf(sim), {
            kind: 'placePalisade',
            gfxIndex: 691,
            x,
            y: 6,
            tribe: 1,
            owner: 0,
          });
      }
    const e = sim.world.create();
    addPerson(sim.world, e, {
      tribe: 1,
      jobType: 1,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(e, Owner, { player: 0 });
    const start = terrain.nodeAt(4, 4);
    let goal = terrain.nodeAt(6, 8);
    sim.world.add(e, Position, positionOfNode(4, 4));
    sim.world.add(e, MoveGoal, { cell: goal });
    navigationPlanner(sim.world, terrain);
    pathfindingSystem(sim.world, ctxOf(sim));
    expect(
      sim.world.get(e, PathRoute).waypoints.map((p) => [terrain.xOf(p.node), terrain.yOf(p.node)]),
    ).toEqual([
      [4, 4],
      [4, 5],
      [5, 6],
      [5, 7],
      [6, 8],
    ]);
    sim.world.mut(e, PathFollow).index = 2;
    const y = fx.fromFloat(change === 'late-wall' || change.includes('sealed') ? 2.98 : 2.7);
    sim.world.add(e, Position, {
      x: positionXOfWorld(fx.fromFloat(change === 'late-wall' || change.includes('sealed') ? 2.49 : 2.35), y),
      y,
    });
    if (change === 'redirect-sealed') {
      const follow = sim.world.mut(e, PathFollow);
      follow.legCost = 8;
      follow.legElapsed = 4;
      follow.legStartedAt = undefined;
      goal = terrain.nodeAt(7, 8);
      sim.world.add(e, MoveGoal, { cell: goal });
      navigationPlanner(sim.world, terrain);
      pathfindingSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(e, PathFollow).index).toBeGreaterThan(0);
    }
    if (change.endsWith('landscape')) {
      const obstacle = sim.world.create();
      sim.world.add(obstacle, Position, positionOfNode(5, 6));
      stampResourceFootprintData(sim.world, obstacle, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
      invalidateLandscapeRoutes(sim.world, terrain, new Set([terrain.nodeAt(5, 6)]));
    } else
      placePalisade(sim.world, ctxOf(sim), {
        kind: 'placePalisade',
        gfxIndex: 691,
        x: 5,
        y: 6,
        tribe: 1,
        owner: 0,
      });
    expect(terrain.isWalkable(sim.world.get(e, PathRequest).start)).toBe(true);
    expect(findPath(terrain, start, goal, dynamicBlockOverlay(sim.world, ctxOf(sim), terrain)) !== null).toBe(
      !change.includes('sealed'),
    );
    if (change === 'wall-restored') {
      expect(sim.world.get(e, PathRequest).retainRoute).toBe(true);
      const hash = sim.hashState();
      sim = restoreSimulation(exportSaveGame(sim), options);
      expect(sim.hashState()).toBe(hash);
      expect(sim.world.get(e, PathRequest).retainRoute).toBe(true);
    }
    const safePrefix = sim.world.tryGet(e, PathRoute)?.waypoints;
    pathfindingSystem(sim.world, ctxOf(sim));
    if (change !== 'landscape') {
      if (safePrefix === undefined) throw new Error('safe return prefix');
      expect(sim.world.get(e, PathRoute).waypoints.slice(0, safePrefix.length)).toEqual(safePrefix);
    }
    expect(sim.world.tryGet(e, PathRequest)?.failed ?? false).toBe(change.includes('sealed'));

    let lost = false;
    for (let tick = 0; tick < 150; tick++) {
      sim.step();
      if (change.includes('sealed')) expect(sim.world.get(e, Position).y).toBeLessThan(fx.fromInt(3));
      lost ||= sim.events.current().some((event) => event.kind === 'settlerLost' && event.entity === e);
    }
    expect(lost).toBe(change.includes('sealed'));
    expect(sim.world.get(e, Position)).toEqual(
      change.includes('sealed') ? positionOfNode(4, 4) : positionOfNode(6, 8),
    );
  });
});
