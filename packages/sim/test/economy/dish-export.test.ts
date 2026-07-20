import { describe, expect, it } from 'vitest';
import { Carrying, CurrentAtomic, Stockpile } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { carriedGoodForm } from '../../src/systems/agents/economy/routing.js';
import { aiSystem, stockCapacity } from '../../src/systems/index.js';
import { exportedGoodForm } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import {
  BREAD,
  buildingAt,
  CARPENTER,
  CARRIER,
  ctxOf,
  FOOD_SIMPLE,
  grassMap,
  HEADQUARTERS,
  KITCHEN,
  PICKUP_ATOMIC,
  pileAt,
  settlerAt,
  WOOD,
} from './producer-supply/support.js';

/**
 * The DISH→EDIBLE conversion (`readviews/food.ts`): a good the original stocks only inside the house
 * that cooks it — bread, candy, meat, fish, fruit, sausage — leaves that house as `food_simple` /
 * `food_extra`, the forms every warehouse and home actually holds. Fixture: good 7 = bread (a dish,
 * slotted only in building 21 = the kitchen), good 3 = food_simple, and the HQ holds food but never a
 * loaf. Without the conversion a dish is a dead end — no store can take it, so no carrier lifts it and
 * the kitchen wedges at a full shelf with its staff idle, which is the reported bug.
 */
describe('a dish leaves the kitchen as the edible it becomes', () => {
  it('no store can hold the dish itself — the conversion is the only way out', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0);
    const ctx = ctxOf(sim);

    // The premise the whole mechanic rests on: the settlement larder has room for food and none at all
    // for bread. A test that let the HQ stock loaves would pass while the real content still deadlocked.
    expect(stockCapacity(sim.world, ctx, hq, BREAD)).toBe(0);
    expect(stockCapacity(sim.world, ctx, hq, FOOD_SIMPLE)).toBeGreaterThan(0);
    expect(exportedGoodForm(ctx, BREAD)).toBe(FOOD_SIMPLE);
    expect(exportedGoodForm(ctx, WOOD)).toBe(WOOD); // an ordinary good is carried as itself
  });

  it('converts only on the way out of the house that produces the dish', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const kitchen = buildingAt(sim, KITCHEN, 0, 0, [[BREAD, 1]]);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0);
    const heap = pileAt(sim, 5, 0, [[BREAD, 1]]);
    const ctx = ctxOf(sim);

    expect(carriedGoodForm(sim.world, ctx, kitchen, BREAD)).toBe(FOOD_SIMPLE);
    // A store that merely HOLDS the dish, and a loose heap, hand it over raw. Scoping this matters for
    // meat: it is a dish AND a map-harvested good, so converting it wherever it was found would stop a
    // porter routing a meat heap to the one building that stocks meat.
    expect(carriedGoodForm(sim.world, ctx, hq, BREAD)).toBe(BREAD);
    expect(carriedGoodForm(sim.world, ctx, heap, BREAD)).toBe(BREAD);
    expect(carriedGoodForm(sim.world, ctx, null, BREAD)).toBe(BREAD);
    expect(carriedGoodForm(sim.world, ctx, kitchen, WOOD)).toBe(WOOD); // not a dish
  });

  it('a baker with a full bread shelf carries one out instead of standing idle', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The reported situation: the shelf is at the brim (5 loaves) with input on hand, so nothing can
    // start until a loaf leaves. The HQ is the sink — for food, not for bread.
    const kitchen = buildingAt(sim, KITCHEN, 0, 0, [
      [WOOD, 10],
      [BREAD, 5],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    const baker = settlerAt(sim, 0, 0, CARPENTER, kitchen);

    aiSystem(sim.world, ctxOf(sim));

    // It lifts the good the kitchen actually holds — the conversion happens when the swing completes.
    const atomic = sim.world.get(baker, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: BREAD, amount: 1, from: kitchen });
  });

  it('end to end: the loaf reaches the headquarters as food and the kitchen bakes on', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(6, 1) });
    const kitchen = buildingAt(sim, KITCHEN, 0, 0, [
      [WOOD, 10],
      [BREAD, 5],
    ]);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 0, 0, CARPENTER, kitchen);
    settlerAt(sim, 3, 0, CARRIER, kitchen);

    let produced = 0;
    for (let i = 0; i < 600; i++) {
      sim.step();
      for (const ev of sim.events.current()) if (ev.kind === 'goodProduced') produced += ev.amount;
    }

    const larder = sim.world.get(hq, Stockpile).amounts;
    const shelf = sim.world.get(kitchen, Stockpile).amounts;
    // Loaves banked as food, and the freed shelf let the oven run again — the stall is gone.
    expect(larder.get(FOOD_SIMPLE) ?? 0).toBeGreaterThan(0);
    expect(produced).toBeGreaterThan(0);
    expect(larder.get(BREAD) ?? 0).toBe(0); // the HQ never holds a loaf as a loaf
    // Amounts are conserved even though identity is not: every loaf ever baked is on the shelf, banked
    // as one unit of food, or in flight on a carrier's back — none created, none lost in the swap.
    let inFlight = 0;
    for (const e of sim.world.query(Carrying)) {
      const load = sim.world.get(e, Carrying);
      if (load.goodType === BREAD || load.goodType === FOOD_SIMPLE) inFlight += load.amount;
    }
    expect((shelf.get(BREAD) ?? 0) + (larder.get(FOOD_SIMPLE) ?? 0) + inFlight).toBe(5 + produced);
  });

  it('the baker walking away from the kitchen is holding food, not bread', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(6, 1) });
    const kitchen = buildingAt(sim, KITCHEN, 0, 0, [
      [WOOD, 10],
      [BREAD, 5],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    const baker = settlerAt(sim, 0, 0, CARPENTER, kitchen);

    for (let i = 0; i < 60 && sim.world.tryGet(baker, Carrying) === undefined; i++) sim.step();

    const load = sim.world.tryGet(baker, Carrying);
    expect(load).toBeDefined();
    expect(load?.goodType).toBe(FOOD_SIMPLE);
  });
});
