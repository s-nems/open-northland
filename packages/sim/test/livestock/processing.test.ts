import { describe, expect, it } from 'vitest';
import { Health, MoveGoal, Production, Stockpile } from '../../src/components/index.js';
import type { Simulation } from '../../src/index.js';
import {
  beginCycle,
  canStartCycle,
  depositCycleOutput,
} from '../../src/systems/economy/production/cycles.js';
import {
  LIVESTOCK_PROCESS_DRAIN_HP,
  productionSystem,
  startableCycleCount,
} from '../../src/systems/index.js';
import { recipesByProductOf } from '../../src/systems/stores/index.js';
import {
  breederAt,
  COW_GOOD,
  COW_HP,
  cowAt,
  ctxOf,
  FEED_TICKS,
  farmAt,
  livestockSim,
  MEAT,
  MEAT_CAPACITY,
  WATER,
  WHEAT,
  WOOL,
} from './support.js';

const P0 = 0;
const P1 = 1;

/** A farm stocked for two feed batches, anchored on node (10, 10). */
function stockedFarm(sim: Simulation, opts: { owner?: number } = {}) {
  const farm = farmAt(sim, 10, 10, {
    stock: [
      [WATER, 2],
      [WHEAT, 4],
    ],
    ...opts,
  });
  const ctx = ctxOf(sim);
  const recipes = recipesByProductOf(sim.world, ctx, farm);
  if (recipes === undefined) throw new Error('fixture farm always has recipes');
  const feed = recipes.get(COW_GOOD);
  if (feed === undefined) throw new Error('fixture farm always has the feed recipe');
  return { farm, ctx, recipes, feed };
}

describe('livestock processing - feed cycles run against a live penned animal', () => {
  it('starts nothing without an animal, despite stocked inputs', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(0);
  });

  it('counts eligible animals as the parallel-batch cap', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    cowAt(sim, 11, 10);
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(1);
    cowAt(sim, 12, 10);
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(2);
  });

  it('rejects an animal the drain would leave under half its pool', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    // 700 - 250 = 450 < 500: one visit would breach the floor.
    cowAt(sim, 11, 10, { hp: COW_HP / 2 + LIVESTOCK_PROCESS_DRAIN_HP - 50 });
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(0);
  });

  it('ignores an animal outside the pen radius', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    cowAt(sim, 50, 40); // Manhattan 70 from the door
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(0);
  });

  it("an owned farm processes only its own player's stock - never wild or enemy animals", () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim, { owner: P0 });
    cowAt(sim, 11, 10); // wild
    cowAt(sim, 12, 10, { owner: P1 }); // enemy stock
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(0);
    cowAt(sim, 13, 10, { owner: P0 });
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(1);
  });

  it('beginCycle drains the animal and walks it to the door; inputs are consumed', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    const cow = cowAt(sim, 14, 10);

    beginCycle(sim.world, ctx, farm, feed, COW_GOOD);

    expect(sim.world.get(cow, Health).hitpoints).toBe(COW_HP - LIVESTOCK_PROCESS_DRAIN_HP);
    expect(sim.world.has(cow, MoveGoal)).toBe(true);
    const stock = sim.world.get(farm, Stockpile).amounts;
    expect(stock.get(WATER)).toBe(1);
    expect(stock.get(WHEAT)).toBe(2);
    expect(sim.world.get(farm, Production).cycles).toHaveLength(1);
  });

  it('drains the healthiest animal first (canonical pick)', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    const worn = cowAt(sim, 11, 10, { hp: COW_HP - 100 });
    const fresh = cowAt(sim, 12, 10);

    beginCycle(sim.world, ctx, farm, feed, COW_GOOD);

    expect(sim.world.get(fresh, Health).hitpoints).toBe(COW_HP - LIVESTOCK_PROCESS_DRAIN_HP);
    expect(sim.world.get(worn, Health).hitpoints).toBe(COW_HP - 100);
  });

  it('a completed feed cycle deposits its product plus one meat, forfeited on a full shelf', () => {
    const sim = livestockSim();
    const { farm, ctx, recipes } = stockedFarm(sim);
    const cycle = { elapsed: FEED_TICKS, duration: FEED_TICKS, goodType: COW_GOOD };

    depositCycleOutput(sim.world, ctx, farm, cycle, recipes);
    const stock = sim.world.get(farm, Stockpile).amounts;
    expect(stock.get(COW_GOOD)).toBe(1);
    expect(stock.get(MEAT)).toBe(1);

    depositCycleOutput(sim.world, ctx, farm, cycle, recipes);
    depositCycleOutput(sim.world, ctx, farm, cycle, recipes);
    expect(sim.world.get(farm, Stockpile).amounts.get(MEAT)).toBe(MEAT_CAPACITY); // the third is forfeited
  });

  it('the conversion recipe (fed-cow → wool) needs no live animal', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 10, 10, { stock: [[COW_GOOD, 1]] });
    const ctx = ctxOf(sim);
    const recipes = recipesByProductOf(sim.world, ctx, farm);
    const convert = recipes?.get(WOOL);
    if (convert === undefined) throw new Error('fixture farm always has the wool recipe');
    expect(canStartCycle(sim.world, ctx, farm, convert)).toBe(true);
  });

  it('a staffed farm turns water+wheat and cow life into wool and meat through the system loop', () => {
    const sim = livestockSim();
    const { farm, ctx } = stockedFarm(sim);
    const cow = cowAt(sim, 12, 10);
    breederAt(sim, 10, 10); // on the interaction node - the operator that runs the craft

    // One operator runs the chain serially: feed (10 ticks, drains the cow, +1 meat byproduct), then
    // the rotation converts the fed-cow good to wool (10 more).
    for (let i = 0; i <= 2 * (FEED_TICKS + 1) + 2; i++) productionSystem(sim.world, ctx);

    const stock = sim.world.get(farm, Stockpile).amounts;
    expect(stock.get(WOOL)).toBeGreaterThanOrEqual(1);
    expect(stock.get(MEAT)).toBeGreaterThanOrEqual(1);
    expect(sim.world.get(cow, Health).hitpoints).toBeLessThan(COW_HP);
    // The floor held throughout: the drain never took the cow under half its pool.
    expect(sim.world.get(cow, Health).hitpoints).toBeGreaterThanOrEqual(COW_HP / 2);
  });
});
