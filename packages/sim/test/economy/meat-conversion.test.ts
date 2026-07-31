import { describe, expect, it } from 'vitest';
import { Carrying, Stockpile } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { pickupFromStore, pileupIntoStore } from '../../src/systems/settlers/atomics/effects/goods/index.js';
import { carriedGoodForm } from '../../src/systems/settlers/drives/economy/delivery-targets.js';
import { testContent } from '../fixtures/content.js';
import {
  buildingAt,
  CARRIER,
  ctxOf,
  FOOD_SIMPLE,
  grassMap,
  HEADQUARTERS,
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
