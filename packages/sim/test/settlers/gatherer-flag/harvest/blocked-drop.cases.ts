import { describe, expect, it } from 'vitest';
import {
  Building,
  DeliveryFlag,
  HarvestedBy,
  MoveGoal,
  Position,
  Resource,
  WorkFlag,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../../../src/index.js';
import { aiSystem, stampResourceFootprint } from '../../../../src/systems/index.js';
import { grassCellMap } from '../../../fixtures/terrain.js';
import {
  content,
  TEST_HUT,
  VIKING,
  WOOD,
  WOOD_ATOMIC,
} from '../../../footprint/resource-footprint/content.js';
import {
  ctxOf,
  placeGroundDrop,
  placeWoodcutter,
  terrainOf,
} from '../../../footprint/resource-footprint/support.js';

/** A footprinted tree (walk-blocks its anchor; work cells left/right) at half-cell node (x,y). */
function placeFootprintedTree(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 3, harvestAtomic: WOOD_ATOMIC });
  expect(stampResourceFootprint(sim.world, sim.content, e, WOOD)).toBe(true);
  return e;
}

describe('flag-bound gatherer — a drop on a blocked cell is left for later, not stranded on', () => {
  // The dense-field stall (magiczny_las, seat-2 stone collector, ~tick 4100): the last dig leaves the
  // drop on the dug-out anchor, still covered by neighbouring walk bodies — a walk goal `findPath`
  // always rejects. The pile scans must skip such a drop so the gatherer keeps digging instead of
  // looping park→re-pick→fail forever.
  function flagBoundCutter(sim: Simulation): Entity {
    const gatherer = placeWoodcutter(sim, 1, 1);
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(1, 3));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(gatherer, WorkFlag, { flag, radius: 40 });
    return gatherer;
  }

  it('skips its own drop under a walk-block and harvests the reachable tree instead', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassCellMap(10, 5) });
    const terrain = terrainOf(sim);
    const gatherer = flagBoundCutter(sim);
    const drop = placeGroundDrop(sim, WOOD, 1, 5, 1);
    sim.world.add(drop, HarvestedBy, { by: gatherer });
    // A completed hut whose walk-block covers the drop's cell (its door at (5,2) stays walkable).
    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(5, 1));
    sim.world.add(hut, Building, { buildingType: TEST_HUT, tribe: VIKING, built: ONE, level: 0 });
    placeFootprintedTree(sim, 3, 1); // work cells (2,1)/(4,1) — reachable digging instead

    aiSystem(sim.world, ctxOf(sim));

    // The doomed drop is skipped: the walk goal is the tree's near work cell, not the blocked drop.
    expect(sim.world.get(gatherer, MoveGoal).cell).toBe(terrain.nodeAt(2, 1));
  });

  it('still reclaims the same drop when its cell is free (the gate keys on blockage alone)', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassCellMap(10, 5) });
    const terrain = terrainOf(sim);
    const gatherer = flagBoundCutter(sim);
    const drop = placeGroundDrop(sim, WOOD, 1, 5, 1);
    sim.world.add(drop, HarvestedBy, { by: gatherer });
    placeFootprintedTree(sim, 3, 1);

    aiSystem(sim.world, ctxOf(sim));

    // No block over the drop: finishing the own drop outranks a fresh harvest (rung 1 before rung 2).
    expect(sim.world.get(gatherer, MoveGoal).cell).toBe(terrain.nodeAt(5, 1));
  });
});
