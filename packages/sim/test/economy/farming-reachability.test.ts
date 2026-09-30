import { describe, expect, it } from 'vitest';
import {
  FarmTask,
  GroundDrop,
  MoveGoal,
  PathRequest,
  Position,
  Stockpile,
  Stranded,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import { plannerSystem, routeRegions, stampResourceFootprintData } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { FIELD_CAP, farmAt, farmerAt, fieldAtNode, STAGES, WHEAT } from './farming/support.js';

const RING = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 2 },
  { dx: 1, dy: -2 },
  { dx: -1, dy: 2 },
  { dx: -1, dy: -2 },
];

function setup() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(30, 20) });
  const farm = farmAt(sim, 2, 3);
  const farmer = farmerAt(sim, 1, 3, farm);
  const wall = sim.world.create();
  sim.world.add(wall, Position, positionOfNode(10, 6));
  stampResourceFootprintData(sim.world, wall, { walk: RING, build: [], work: [] });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('terrain missing');
  expect(
    routeRegions(sim.world, ctxOf(sim), terrain).unroutable(terrain.nodeAt(2, 6), terrain.nodeAt(10, 6)),
  ).toBe(true);
  return { sim, farm, farmer, wall, terrain };
}

function fullPlot(sim: Simulation, farm: Entity, stage: number) {
  const pocket = fieldAtNode(sim, farm, 10, 6, { stage });
  const reachable = fieldAtNode(sim, farm, 3, 16, { stage: stage === STAGES ? STAGES : stage + 1 });
  for (let i = 1; i < FIELD_CAP - 1; i++)
    fieldAtNode(sim, farm, 6 + i, 16, { stage: stage === STAGES ? STAGES : stage + 1 });
  return { pocket, reachable };
}

function sheaf(sim: Simulation, hx: number, hy: number) {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Stockpile, { amounts: new Map([[WHEAT, 1]]) });
  sim.world.add(e, GroundDrop, { goodType: WHEAT });
  return e;
}

describe('farm work region reachability', () => {
  it.each([STAGES, 1])(
    'works reachable fields before enclosed ripe or thirsty fields (stage %i)',
    (stage) => {
      const { sim, farm, farmer } = setup();
      const { reachable } = fullPlot(sim, farm, stage);
      plannerSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(farmer, FarmTask).target).not.toBeUndefined();
      expect(sim.world.get(farmer, FarmTask).node).toBe(sim.terrain?.nodeAt(3, 16));
      expect(sim.world.get(farmer, FarmTask).target).toBe(reachable);
    },
  );

  it('harvests accessible work without a failed request, Stranded or lost report', () => {
    const { sim, farm, farmer } = setup();
    fullPlot(sim, farm, STAGES);
    let lost = 0;
    for (let i = 0; i < 100; i++) {
      sim.step();
      expect(sim.world.tryGet(farmer, PathRequest)?.failed).not.toBe(true);
      expect(sim.world.has(farmer, Stranded)).toBe(false);
      lost += sim.events.current().filter((e) => e.kind === 'settlerLost' && e.entity === farmer).length;
    }
    expect(lost).toBe(0);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('skips an enclosed sheaf and carries the reachable one', () => {
    const { sim, farmer } = setup();
    sheaf(sim, 10, 6);
    const reachable = sheaf(sim, 2, 10);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(farmer, FarmTask).target).toBe(reachable);
  });

  it('drops an enclosed sow intent and picks an accessible sow point', () => {
    const { sim, farmer, farm, terrain } = setup();
    sim.world.add(farmer, FarmTask, { farm, node: terrain.nodeAt(10, 6), sow: true });
    plannerSystem(sim.world, ctxOf(sim));
    const task = sim.world.get(farmer, FarmTask);
    expect(task.sow).toBe(true);
    expect(task.node).not.toBe(terrain.nodeAt(10, 6));
    expect(routeRegions(sim.world, ctxOf(sim), terrain).unroutable(terrain.nodeAt(2, 6), task.node)).toBe(
      false,
    );
  });

  it('sows outside a pocket containing the farm anchor', () => {
    const { sim, farmer, farm, terrain } = setup();
    Object.assign(sim.world.mut(farm, Position), positionOfNode(10, 6));
    plannerSystem(sim.world, ctxOf(sim));
    const task = sim.world.get(farmer, FarmTask);
    expect(task.sow).toBe(true);
    expect(task.node).not.toBe(terrain.nodeAt(10, 6));
    expect(routeRegions(sim.world, ctxOf(sim), terrain).unroutable(terrain.nodeAt(2, 6), task.node)).toBe(
      false,
    );
  });

  it('does not assign outside field work to a farmer trapped in the pocket', () => {
    const { sim, farmer, farm } = setup();
    for (let i = 0; i < FIELD_CAP; i++) fieldAtNode(sim, farm, 3 + i, 16, { stage: STAGES });
    Object.assign(sim.world.mut(farmer, Position), positionOfNode(10, 6));
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(farmer, FarmTask)).toBe(false);
  });

  it('admits the nearer field once the passage opens', () => {
    const { sim, farmer, farm, wall } = setup();
    const { pocket } = fullPlot(sim, farm, STAGES);
    sim.world.destroy(wall);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(farmer, FarmTask).target).toBe(pocket);
  });

  it('works a field underfoot inside the pocket', () => {
    const { sim, farmer, farm } = setup();
    const { pocket } = fullPlot(sim, farm, STAGES);
    Object.assign(sim.world.mut(farmer, Position), positionOfNode(10, 6));
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(farmer, FarmTask).target).toBe(pocket);
    expect(sim.world.has(farmer, MoveGoal)).toBe(false);
  });
});
