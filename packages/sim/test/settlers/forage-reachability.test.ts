import { describe, expect, it } from 'vitest';
import {
  BerryBush,
  MoveGoal,
  Palisade,
  PathRequest,
  Position,
  UnreachableGoals,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, positionOfNode, type ScriptLandscapeType, Simulation } from '../../src/index.js';
import { hexagonRing } from '../../src/nav/halfcell.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { plannerSystem, routeRegions, stampResourceFootprintData } from '../../src/systems/index.js';
import { collectTargets } from '../../src/systems/settlers/targets/candidates.js';
import { nearestFood } from '../../src/systems/settlers/targets/food.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { needsSettlerAt } from '../settlers/needs/support.js';

const SEAL_RING = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 2 },
  { dx: 1, dy: -2 },
  { dx: -1, dy: 2 },
  { dx: -1, dy: -2 },
];

function setup(walk: Array<{ dx: number; dy: number }>) {
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: grassNodeMap(30, 20),
  });
  const eater = needsSettlerAt(sim, 1, 3, { hunger: ONE });
  const berry = sim.world.create();
  sim.world.add(berry, Position, positionOfNode(10, 6));
  sim.world.add(berry, BerryBush, { stage: 'ripe', nextStageAtTick: 0 });
  const blocker = sim.world.create();
  sim.world.add(blocker, Position, positionOfNode(10, 6));
  stampResourceFootprintData(sim.world, blocker, { walk, build: [], work: [] });
  if (sim.terrain === undefined) throw new Error('terrain missing');
  return { sim, eater, berry, blocker, terrain: sim.terrain };
}

function food(sim: Simulation, eater: Entity, here?: NodeId) {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('terrain missing');
  return nearestFood(
    collectTargets(sim.world, ctxOf(sim), terrain),
    sim.world,
    ctxOf(sim),
    terrain,
    here ?? terrain.nodeAt(2, 6),
    eater,
  );
}

describe('forage target reachability', () => {
  it.each([{ walk: SEAL_RING }, { walk: [{ dx: 0, dy: 0 }, ...SEAL_RING] }])(
    'skips sealed or covered interaction cells',
    ({ walk }) => {
      const { sim, eater } = setup(walk);
      expect(food(sim, eater)).toBeNull();
    },
  );

  it('admits food after a passage opens', () => {
    const { sim, eater, berry, blocker } = setup(SEAL_RING);
    expect(food(sim, eater)).toBeNull();
    sim.world.destroy(blocker);
    expect(food(sim, eater)).toEqual({ kind: 'bush', bush: berry });
  });

  it('admits a bush underfoot inside a sealed pocket', () => {
    const { sim, eater, berry, terrain } = setup(SEAL_RING);
    sim.world.mut(eater, Position).x = positionOfNode(10, 6).x;
    sim.world.mut(eater, Position).y = positionOfNode(10, 6).y;
    expect(food(sim, eater, terrain.nodeAt(10, 6))).toEqual({
      kind: 'bush',
      bush: berry,
    });
  });

  it('keeps a live failed-goal veto and admits the bush when it expires', () => {
    const { sim, eater, berry, terrain } = setup([]);
    sim.world.add(eater, UnreachableGoals, {
      entries: [{ cell: terrain.nodeAt(10, 6), until: 1 }],
    });
    expect(food(sim, eater)).toBeNull();
    const ctx = { ...ctxOf(sim), tick: 1 };
    expect(
      nearestFood(
        collectTargets(sim.world, ctx, terrain),
        sim.world,
        ctx,
        terrain,
        terrain.nodeAt(2, 6),
        eater,
      ),
    ).toEqual({ kind: 'bush', bush: berry });
  });
});

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: {
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [{ goodType: 5, amount: 1 }],
  },
};

it('forages farther reachable berries past a sealed palisade without reporting lost', () => {
  const map = {
    ...grassNodeMap(30, 20),
    landscapes: { types: [WALL], placements: [] },
  };
  const sim = new Simulation({ seed: 1, content: testContent(), map });
  const berry = sim.world.create();
  sim.world.add(berry, Position, positionOfNode(10, 6));
  sim.world.add(berry, BerryBush, { stage: 'ripe', nextStageAtTick: 0 });
  for (const { point } of hexagonRing({ hx: 10, hy: 6 }, 2)) {
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: point.hx,
      y: point.hy,
      tribe: 1,
    });
  }
  sim.step();
  expect([...sim.world.query(Palisade)]).toHaveLength(12);
  expect(sim.world.has(berry, BerryBush)).toBe(true);
  const eater = needsSettlerAt(sim, 1, 3, { hunger: ONE });
  const farther = sim.world.create();
  sim.world.add(farther, Position, positionOfNode(2, 16));
  sim.world.add(farther, BerryBush, { stage: 'ripe', nextStageAtTick: 0 });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('terrain missing');
  const regions = routeRegions(sim.world, ctxOf(sim), terrain);
  expect(regions.unroutable(terrain.nodeAt(2, 6), terrain.nodeAt(10, 6))).toBe(true);
  expect(regions.unroutable(terrain.nodeAt(2, 6), terrain.nodeAt(2, 16))).toBe(false);
  plannerSystem(sim.world, ctxOf(sim));
  expect(sim.world.get(eater, MoveGoal).cell).toBe(terrain.nodeAt(2, 16));
  let lost = 0;
  let ateFarther = false;
  for (let tick = 0; tick < 300; tick++) {
    sim.step();
    expect(sim.world.tryGet(eater, PathRequest)?.failed).not.toBe(true);
    lost += sim.events
      .current()
      .filter((event) => event.kind === 'settlerLost' && event.entity === eater).length;
    ateFarther ||= sim.world.get(farther, BerryBush).stage === 'bare';
  }
  expect(lost).toBe(0);
  expect(ateFarther).toBe(true);
  expect(sim.checkInvariants()).toEqual([]);
  expect(sim.world.verifyCaches()).toEqual([]);
});
