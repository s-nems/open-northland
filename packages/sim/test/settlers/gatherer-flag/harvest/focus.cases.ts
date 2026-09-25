import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  DeliveryFlag,
  HarvestFocus,
  MoveGoal,
  Owner,
  PathRequest,
  Position,
  Resource,
  UnreachableGoals,
  WorkFlag,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../../../src/index.js';
import { plannerSystem, resourceStanceCells, stampResourceFootprint } from '../../../../src/systems/index.js';
import { setGatherGood } from '../../../../src/systems/orders/work/selection.js';
import { grassCellMap } from '../../../fixtures/terrain.js';
import {
  content,
  TEST_HUT,
  VIKING,
  WOOD,
  WOOD_ATOMIC,
} from '../../../footprint/resource-footprint/content.js';
import { ctxOf, placeWoodcutter, terrainOf } from '../../../footprint/resource-footprint/support.js';

/** A footprinted tree (walk-blocks its anchor; work cells left/right) at half-cell node (x,y). */
function placeFootprintedTree(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 3, harvestAtomic: WOOD_ATOMIC });
  expect(stampResourceFootprint(sim.world, sim.content, e, WOOD)).toBe(true);
  return e;
}

describe('flag-bound gatherer - returning to the node its stroke cadence left part-worked', () => {
  function flagBoundCutter(sim: Simulation): Entity {
    const gatherer = placeWoodcutter(sim, 1, 1);
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(1, 3));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(gatherer, WorkFlag, { flag, radius: 40 });
    return gatherer;
  }

  it('walks back to the remembered node, to one of its stances, ahead of a nearer tree', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassCellMap(12, 5) });
    const terrain = terrainOf(sim);
    const gatherer = flagBoundCutter(sim);
    placeFootprintedTree(sim, 3, 1); // nearer to the flag
    const remembered = placeFootprintedTree(sim, 7, 1);
    sim.world.add(gatherer, HarvestFocus, { node: remembered });

    plannerSystem(sim.world, ctxOf(sim));

    const goal = sim.world.get(gatherer, MoveGoal).cell;
    expect(resourceStanceCells(sim.world, terrain, remembered)).toContain(goal);
    expect(sim.world.has(gatherer, HarvestFocus)).toBe(true);
  });

  it('keeps the stance it drew across planner passes, and draws it from the sim stream per approach', () => {
    const goals = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const sim = new Simulation({ seed, content: content(), map: grassCellMap(12, 5) });
      const gatherer = flagBoundCutter(sim);
      const remembered = placeFootprintedTree(sim, 7, 1);
      sim.world.add(gatherer, HarvestFocus, { node: remembered });
      plannerSystem(sim.world, ctxOf(sim));
      const goal = sim.world.get(gatherer, MoveGoal).cell;
      expect(sim.world.get(gatherer, HarvestFocus).stance).toBe(goal);
      sim.world.remove(gatherer, MoveGoal);
      sim.world.remove(gatherer, PathRequest);
      plannerSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(gatherer, MoveGoal).cell).toBe(goal); // the same approach keeps its goal
      goals.add(goal);
    }
    expect(goals.size).toBeGreaterThan(1); // the draw itself varies with the stream
  });

  it('drops a remembered node that is gone and scans as usual', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassCellMap(12, 5) });
    const terrain = terrainOf(sim);
    const gatherer = flagBoundCutter(sim);
    const near = placeFootprintedTree(sim, 3, 1);
    const gone = sim.world.create();
    sim.world.add(gatherer, HarvestFocus, { node: gone });

    plannerSystem(sim.world, ctxOf(sim));

    expect(resourceStanceCells(sim.world, terrain, near)).toContain(sim.world.get(gatherer, MoveGoal).cell);
    expect(sim.world.get(gatherer, HarvestFocus).node).toBe(near); // the scan's pick is the new approach
  });

  it('draws only stances it can route to: a stance under a walk-block or in its failed-goal memo is skipped', () => {
    const terrainSim = new Simulation({ seed: 1, content: content(), map: grassCellMap(12, 5) });
    const terrain = terrainOf(terrainSim);
    const nearStance = terrain.nodeAt(6, 1);
    const farStance = terrain.nodeAt(8, 1);
    for (const seal of ['block', 'memo'] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const sim = new Simulation({ seed, content: content(), map: grassCellMap(12, 5) });
        const gatherer = flagBoundCutter(sim);
        const tree = placeFootprintedTree(sim, 7, 1);
        if (seal === 'block') {
          const hut = sim.world.create();
          sim.world.add(hut, Position, positionOfNode(8, 1));
          sim.world.add(hut, Building, { buildingType: TEST_HUT, tribe: VIKING, built: ONE, level: 0 });
        } else {
          sim.world.add(gatherer, UnreachableGoals, { entries: [{ cell: farStance, until: 10_000 }] });
        }
        sim.world.add(gatherer, HarvestFocus, { node: tree });
        plannerSystem(sim.world, ctxOf(sim));
        expect(sim.world.get(gatherer, MoveGoal).cell).toBe(nearStance);
      }
    }
  });

  it('with no stance left to route to, drops the remembered node and lets the scan decide', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassCellMap(12, 5) });
    const terrain = terrainOf(sim);
    const gatherer = flagBoundCutter(sim);
    const sealed = placeFootprintedTree(sim, 7, 1);
    const other = placeFootprintedTree(sim, 3, 1);
    sim.world.add(gatherer, UnreachableGoals, {
      entries: [terrain.nodeAt(6, 1), terrain.nodeAt(8, 1)].map((cell) => ({ cell, until: 10_000 })),
    });
    sim.world.add(gatherer, HarvestFocus, { node: sealed });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(gatherer, HarvestFocus).node).toBe(other);
    expect(resourceStanceCells(sim.world, terrain, other)).toContain(sim.world.get(gatherer, MoveGoal).cell);
  });

  it('a stance its routes failed on drops the remembered node before the next approach', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassCellMap(12, 5) });
    const terrain = terrainOf(sim);
    const gatherer = flagBoundCutter(sim);
    const remembered = placeFootprintedTree(sim, 7, 1);
    const near = placeFootprintedTree(sim, 3, 1);
    sim.world.add(gatherer, HarvestFocus, { node: remembered, stance: terrain.nodeAt(8, 1) });
    sim.world.add(gatherer, UnreachableGoals, { entries: [{ cell: terrain.nodeAt(8, 1), until: 10_000 }] });

    plannerSystem(sim.world, ctxOf(sim));

    expect([remembered, near]).toContain(sim.world.get(gatherer, HarvestFocus).node); // re-picked by the scan
    expect(sim.world.get(gatherer, HarvestFocus).stance).not.toBe(terrain.nodeAt(8, 1));
  });

  it('a changed gather good clears the mark, so the search restarts under the new filter', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassCellMap(12, 5) });
    const gatherer = flagBoundCutter(sim);
    sim.world.add(gatherer, Owner, { player: 0 }); // orders reach owned settlers only
    const remembered = placeFootprintedTree(sim, 7, 1);
    sim.world.add(gatherer, HarvestFocus, { node: remembered });
    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: WOOD });
    expect(sim.world.has(gatherer, HarvestFocus)).toBe(false);
  });

  it('a colleague already on the remembered node this pass takes it; the mark is dropped', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassCellMap(12, 5) });
    const gatherer = flagBoundCutter(sim);
    const rival = placeWoodcutter(sim, 6, 1);
    const remembered = placeFootprintedTree(sim, 7, 1);
    sim.world.add(gatherer, HarvestFocus, { node: remembered });
    sim.world.add(rival, CurrentAtomic, {
      atomicId: WOOD_ATOMIC,
      duration: 5,
      effect: { kind: 'harvest', resource: remembered, goodType: WOOD },
      targetEntity: remembered,
      targetTile: null,
    });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(gatherer, HarvestFocus)).toBe(false);
  });
});
