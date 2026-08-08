import { describe, expect, it } from 'vitest';
import { Carrying, CurrentAtomic, GroundDrop, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { plannerSystem, stockCapacity } from '../../src/systems/index.js';
import { pickupFromStore, pileupIntoStore } from '../../src/systems/settlers/atomics/effects/goods/index.js';
import { carriedGoodForm } from '../../src/systems/settlers/drives/economy/delivery-targets.js';
import { canStoreGood } from '../../src/systems/settlers/targets/stores/stock.js';
import { testContent } from '../fixtures/content.js';
import {
  BAKEHOUSE,
  buildingAt,
  CARRIER,
  ctxOf,
  FOOD_SIMPLE,
  grassMap,
  HEADQUARTERS,
  PICKUP_ATOMIC,
  pileAt,
  settlerAt,
} from './producer-supply/support.js';

/** The fixture meat good (its harvest atomic 33 is granted to the hunter job 15 alone). */
const MEAT = 21;
const HUNTER = 15;

/**
 * MEAT's raw/food identity: only the hunter handles meat as meat - its flag yard heaps it raw. In
 * anyone else's hands the lift turns it into `food_simple` ({@link carriedGoodForm} - the rule and
 * source basis live there), and a store with no meat slot banks a delivered unit as food
 * (`pileupIntoStore`).
 */
describe("meat converts to food in every hand but the hunter's own", () => {
  it('a porter lifting a meat heap holds food; the hunter lifting the same heap holds meat', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const heap = pileAt(sim, 2, 0, [[MEAT, 2]]);
    const porter = settlerAt(sim, 2, 0, CARRIER);
    const hunter = settlerAt(sim, 2, 0, HUNTER);
    const ctx = ctxOf(sim);

    expect(carriedGoodForm(sim.world, ctx, porter, MEAT)).toBe(FOOD_SIMPLE);
    expect(carriedGoodForm(sim.world, ctx, hunter, MEAT)).toBe(MEAT);

    pickupFromStore(sim.world, ctx, porter, heap, MEAT, 1);
    pickupFromStore(sim.world, ctx, hunter, heap, MEAT, 1);
    expect(sim.world.get(porter, Carrying)).toEqual({ goodType: FOOD_SIMPLE, amount: 1 });
    expect(sim.world.get(hunter, Carrying)).toEqual({ goodType: MEAT, amount: 1 });
  });

  it('meat delivered to a store with no meat slot banks as food (the warehouse conversion)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0);
    const hunter = settlerAt(sim, 3, 0, HUNTER);
    sim.world.add(hunter, Carrying, { goodType: MEAT, amount: 1 });
    const ctx = ctxOf(sim);

    const moved = pileupIntoStore(sim.world, ctx, hunter, hq);

    expect(moved).toBe(1);
    expect(sim.world.has(hunter, Carrying)).toBe(false);
    const larder = sim.world.get(hq, Stockpile).amounts;
    expect(larder.get(FOOD_SIMPLE) ?? 0).toBe(1); // banked as food ...
    expect(larder.get(MEAT) ?? 0).toBe(0); // ... never as a raw slab in the larder
  });
});

/** An uncollected kill's drop: the heap plus the {@link GroundDrop} marker a real harvest stamps. */
function dropAt(sim: Simulation, x: number, y: number, goodType: number, amount: number): Entity {
  const e = pileAt(sim, x, y, [[goodType, amount]]);
  sim.world.add(e, GroundDrop, { goodType });
  return e;
}

/**
 * The routing half of the same rule: both the collect scan and the delivery routing must see the larder
 * through the banked form the deposit above would use. The hunter is the only trade that reaches a store
 * still holding MEAT ({@link carriedGoodForm} spares his lift), so he is the only one for whom "the larder
 * banks the edible" and "the larder can take this load" can disagree. He works his kill's own drop - the
 * only meat a posted hunter collects, since ferrying loose stock is the carrier's trade.
 */
describe('a hunter employed at a larder delivers his meat into it', () => {
  it('lifts a meat heap the larder can only bank as food', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 4, 0);
    const heap = dropAt(sim, 1, 0, MEAT, 3);
    const hunter = settlerAt(sim, 1, 0, HUNTER, hq);

    plannerSystem(sim.world, ctxOf(sim));

    // tryGet, not get: planning NOTHING is the regression this pins, and it should read as a failed
    // expectation rather than an ECS "no such component" throw.
    const atomic = sim.world.tryGet(hunter, CurrentAtomic);
    expect(atomic?.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic?.effect).toMatchObject({ kind: 'pickup', goodType: MEAT, from: heap });
  });

  it('end to end: the heap he collects reaches the larder as food', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 4, 0);
    dropAt(sim, 1, 0, MEAT, 2);
    settlerAt(sim, 1, 0, HUNTER, hq);

    for (let i = 0; i < 400; i++) sim.step();

    const larder = sim.world.get(hq, Stockpile).amounts;
    expect(larder.get(FOOD_SIMPLE) ?? 0).toBe(2);
    expect(larder.get(MEAT) ?? 0).toBe(0);
  });

  // The gate that keeps the widened routing from hauling a load INTO its own producer: the fixture
  // bakehouse (20) bakes `food_simple` from wheat and slots it, so judging meat by its raw form alone
  // would make the oven the "nearest capable store" for the hunter's kill and ping-pong it back out.
  it('never routes meat into a store that PRODUCES the food it would bank as', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const bakehouse = buildingAt(sim, BAKEHOUSE, 2, 0);
    const hq = buildingAt(sim, HEADQUARTERS, 6, 0);
    const ctx = ctxOf(sim);

    expect(stockCapacity(sim.world, ctx, bakehouse, FOOD_SIMPLE)).toBeGreaterThan(0); // it has the slot ...
    expect(canStoreGood(sim.world, ctx, bakehouse, MEAT)).toBe(false); // ... and still refuses the meat
    expect(canStoreGood(sim.world, ctx, hq, MEAT)).toBe(true);
  });
});
