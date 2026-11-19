import type { Recipe } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { JobAssignment } from '../../../../../../src/components/index.js';
import type { Entity } from '../../../../../../src/ecs/world.js';
import type { NodeId } from '../../../../../../src/index.js';
import { navigationLimitFor } from '../../../../../../src/systems/index.js';
import { nearestMissingInputSource } from '../../../../../../src/systems/settlers/drives/economy/workshop/supply.js';
import type { PlannerContext } from '../../../../../../src/systems/settlers/planner/context.js';
import { collectTargets, interactionCell } from '../../../../../../src/systems/settlers/targets/index.js';
import { GossipCandidates } from '../../../../../../src/systems/social/index.js';
import { manhattan } from '../../../../../../src/systems/spatial/metric.js';
import { collectSupplyTally } from '../../../../../../src/systems/stores/index.js';
import { ctxOf } from '../../../../../fixtures/context.js';
import {
  ACROSS_CELL,
  AWAY_CELL,
  buildingOn,
  nodeOfCell,
  ORIGIN_CELL,
  RIVER_PLAYER,
  riverSim,
  settlerOn,
  UP_THE_BANK_CELL,
} from '../../../../../fixtures/river-bank.js';

const VIKING = 1;
const CARPENTER = 2;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const WOOD = 1;
const WOOD_UNITS = 5;
const RECIPE: Recipe = { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [], ticks: 1 };

describe("a workshop's input fetch across a river", () => {
  it("takes the store up the workshop's own bank, a longer line and a shorter walk from its door", () => {
    const { sim, terrain } = riverSim(true);
    const mill = buildingOn(sim, ORIGIN_CELL, SAWMILL);
    const across = buildingOn(sim, ACROSS_CELL, HEADQUARTERS, [[WOOD, WOOD_UNITS]]);
    const upTheBank = buildingOn(sim, UP_THE_BANK_CELL, HEADQUARTERS, [[WOOD, WOOD_UNITS]]);
    // Off the door, so the carpenter's own walk is not the one the fetch ranks by.
    const carpenter = settlerOn(sim, AWAY_CELL, CARPENTER);
    sim.world.add(carpenter, JobAssignment, { workplace: mill });
    const ctx = ctxOf(sim);
    const plan: PlannerContext = {
      world: sim.world,
      ctx,
      terrain,
      entity: carpenter,
      here: nodeOfCell(terrain, AWAY_CELL),
      tribe: VIKING,
      jobType: CARPENTER,
      experience: new Map(),
      owner: RIVER_PLAYER,
      limit: navigationLimitFor(sim.world, sim.content, terrain, carpenter),
      targets: collectTargets(sim.world, ctx, terrain),
      supply: collectSupplyTally(sim.world),
      gossipCandidates: new GossipCandidates(sim.world, sim.content),
    };
    const door = interactionCell(sim.world, ctx, terrain, mill, plan.here);
    const doorOf = (store: Entity): NodeId => interactionCell(sim.world, ctx, terrain, store, plan.here);
    expect(manhattan(terrain, door, doorOf(across))).toBeLessThan(
      manhattan(terrain, door, doorOf(upTheBank)),
    );
    expect(plan.limit?.allowsNode(doorOf(across))).toBe(true);

    const source = nearestMissingInputSource(plan, mill, RECIPE, { restockToCapacity: false });
    expect(source?.store).toBe(upTheBank);
    // Nothing confines the same worker: no walk is measured, and the line decides.
    const free = nearestMissingInputSource({ ...plan, limit: null }, mill, RECIPE, {
      restockToCapacity: false,
    });
    expect(free?.store).toBe(across);
  });
});
