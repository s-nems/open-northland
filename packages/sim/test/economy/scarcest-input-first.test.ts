import type { Recipe } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import {
  type InputShortfall,
  nearestMissingInputSource,
} from '../../src/systems/settlers/drives/economy/workshop/supply.js';
import type { PlannerContext } from '../../src/systems/settlers/planner/context.js';
import { collectTargets } from '../../src/systems/settlers/targets/index.js';
import { GossipCandidates } from '../../src/systems/social/index.js';
import { collectInboundSupply } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import {
  BAKEHOUSE,
  buildingAt,
  CARRIER,
  cell,
  ctxOf,
  FOOD_SIMPLE,
  grassMap,
  settlerAt,
  VIKING,
  WHEAT,
  WOOD,
} from './producer-supply/support.js';

/**
 * A producer's input fetch (`nearestMissingInputSource`) brings the input its workplace lacks most:
 * short inputs rank by `have / target`, emptiest first and ties in recipe order, and an input no store
 * holds falls through to the next. The bakehouse fixture's wood and wheat slots hold 10 and its food slot
 * 20, so the carrier's capacity target and an operator's recipe amounts can be told apart.
 */

/** testContent's general storage, stocking every fixture good. */
const WAREHOUSE = 7;
const CARRIER_SHORTFALL: InputShortfall = { restockToCapacity: true };
const OPERATOR_SHORTFALL: InputShortfall = { restockToCapacity: false };
/** Enough of each good in the warehouse that any input can be fetched from it. */
const WAREHOUSE_UNITS = 50;

function recipeOf(inputs: Array<[goodType: number, amount: number]>): Recipe {
  return {
    inputs: inputs.map(([goodType, amount]) => ({ goodType, amount })),
    outputs: [],
    ticks: 1,
  };
}

/** A bakehouse at the strip's west end holding `stocked`, its bound carrier beside it (the planning
 *  settler) and a warehouse to the east holding `sources`. */
function bakehouseScene(
  stocked: Array<[number, number]>,
  sources: readonly number[],
): { plan: PlannerContext; workplace: Entity; warehouse: Entity } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
  const bakehouse = buildingAt(sim, BAKEHOUSE, 0, 0, stocked);
  const warehouse = buildingAt(
    sim,
    WAREHOUSE,
    6,
    0,
    sources.map((good) => [good, WAREHOUSE_UNITS]),
  );
  const carrier = settlerAt(sim, 2, 0, CARRIER, bakehouse);
  if (sim.terrain === undefined) throw new Error('mapped fixture');
  const ctx = ctxOf(sim);
  const plan: PlannerContext = {
    world: sim.world,
    ctx,
    terrain: sim.terrain,
    entity: carrier,
    here: cell(sim, 2, 0),
    tribe: VIKING,
    jobType: CARRIER,
    experience: new Map(),
    owner: undefined,
    limit: null,
    targets: collectTargets(sim.world, ctx, sim.terrain),
    inbound: collectInboundSupply(sim.world),
    gossipCandidates: new GossipCandidates(sim.world, sim.content),
  };
  return { plan, workplace: bakehouse, warehouse };
}

function fetchedGood(
  stocked: Array<[number, number]>,
  sources: readonly number[],
  recipe: Recipe,
  shortfall: InputShortfall,
): number | null {
  const { plan, workplace } = bakehouseScene(stocked, sources);
  return nearestMissingInputSource(plan, workplace, recipe, shortfall)?.goodType ?? null;
}

describe('a producer fetches the scarcest recipe input first', () => {
  it('brings the empty input before topping up a nearly full one listed first', () => {
    const recipe = recipeOf([
      [WOOD, 1],
      [WHEAT, 1],
    ]);
    const { plan, workplace, warehouse } = bakehouseScene(
      [
        [WOOD, 9],
        [WHEAT, 0],
      ],
      [WOOD, WHEAT],
    );
    expect(nearestMissingInputSource(plan, workplace, recipe, CARRIER_SHORTFALL)).toEqual({
      store: warehouse,
      goodType: WHEAT,
    });
  });

  it('keeps recipe order between inputs equally short of their targets', () => {
    for (const [first, second] of [
      [WOOD, WHEAT],
      [WHEAT, WOOD],
    ] as const) {
      const recipe = recipeOf([
        [first, 1],
        [second, 1],
      ]);
      const stocked: Array<[number, number]> = [
        [WOOD, 5],
        [WHEAT, 5],
      ];
      expect(fetchedGood(stocked, [WOOD, WHEAT], recipe, CARRIER_SHORTFALL)).toBe(first);
    }
  });

  it('falls through to the next emptiest input when no store holds the emptiest one', () => {
    // Wood 9 of 10, wheat 0 of 10 with no store holding it, food 5 of 20: food ranks after wheat and
    // before wood, which recipe order alone would pick.
    const recipe = recipeOf([
      [WOOD, 1],
      [WHEAT, 1],
      [FOOD_SIMPLE, 1],
    ]);
    const stocked: Array<[number, number]> = [
      [WOOD, 9],
      [WHEAT, 0],
      [FOOD_SIMPLE, 5],
    ];
    expect(fetchedGood(stocked, [WOOD, FOOD_SIMPLE], recipe, CARRIER_SHORTFALL)).toBe(FOOD_SIMPLE);
    expect(fetchedGood(stocked, [WOOD], recipe, CARRIER_SHORTFALL)).toBe(WOOD);
    expect(fetchedGood(stocked, [], recipe, CARRIER_SHORTFALL)).toBeNull();
  });

  it('ranks a carrier by slot capacity and an operator by recipe amount', () => {
    // Wheat 2 of 3 and wood 3 of 5 for the operator (wood emptier); wheat 2 of 10 and wood 3 of 10
    // against the carrier's capacity (wheat emptier).
    const recipe = recipeOf([
      [WHEAT, 3],
      [WOOD, 5],
    ]);
    const stocked: Array<[number, number]> = [
      [WOOD, 3],
      [WHEAT, 2],
    ];
    expect(fetchedGood(stocked, [WOOD, WHEAT], recipe, CARRIER_SHORTFALL)).toBe(WHEAT);
    expect(fetchedGood(stocked, [WOOD, WHEAT], recipe, OPERATOR_SHORTFALL)).toBe(WOOD);
  });
});
