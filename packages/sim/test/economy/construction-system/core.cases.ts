import { describe, expect, it } from 'vitest';
import { Building, Health, Stockpile, SupplyRun, UnderConstruction } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { advanceConstructionLabor } from '../../../src/systems/economy/construction.js';
import {
  collectInboundSupply,
  constructionSystem,
  neededConstructionGoods,
} from '../../../src/systems/index.js';

import {
  builderWith,
  constructionContent,
  ctxOf,
  finishedEvents,
  fullyHammer,
  HEADQUARTERS,
  HOUSE,
  HOUSE_MAX_HP,
  placeSite,
  STONE,
  TOOL_IRON,
  tooledBuilderContent,
  VIKING,
  WOOD,
} from './support.js';

describe('constructionSystem', () => {
  it('caps built at the delivered-material fraction however much a builder has hammered', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 1 }); // needs 2 stone + 1 wood, has only 1 of 3 units
    fullyHammer(sim, e); // the builder has done all the work it can - material is the limit now
    constructionSystem(sim.world, ctxOf(sim));
    // built = min(labor=ONE, delivered=1/3) = 1/3 - the site can't rise past what material backs it.
    expect(sim.world.get(e, Building).built).toBe(fx.div(ONE, fx.fromInt(3)));
    expect(finishedEvents(sim)).toHaveLength(0);
    // The partial materials are NOT consumed - the site keeps waiting on the rest.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(1);
    expect(sim.world.has(e, UnderConstruction)).toBe(true); // still a site
  });

  it('does NOT finish a fully-stocked site with no builder work - labor is required', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 }); // every material present, labor still 0
    constructionSystem(sim.world, ctxOf(sim));
    // built = min(labor=0, delivered=ONE) = 0 - material alone never raises a building; a builder must
    // hammer it. This is the behaviour the whole feature adds.
    expect(sim.world.get(e, Building).built).toBe(fx.fromInt(0));
    expect(finishedEvents(sim)).toHaveLength(0);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(2); // untouched - not consumed
  });

  it('finishes a site once fully hammered AND every material is present, consuming the materials', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 });
    fullyHammer(sim, e);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE); // built
    expect(finishedEvents(sim)).toEqual([{ kind: 'buildingFinished', entity: e }]);
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // a finished building is a plain Building
    // The materials are spent into the structure.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(0);
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBe(0);
  });

  it('leaves any surplus material beyond the cost in the stockpile', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 5, [WOOD]: 3 }); // cost 2 stone + 1 wood
    fullyHammer(sim, e);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(3); // 5 - 2
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBe(2); // 3 - 1
  });

  it('ramps the site Health up with built, then fills it at completion', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 }); // fully stocked (delivered = ONE)
    sim.world.add(e, Health, { hitpoints: 1, max: HOUSE_MAX_HP });
    sim.world.mut(e, UnderConstruction).labor = fx.div(ONE, fx.fromInt(2)); // hammered halfway
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(fx.div(ONE, fx.fromInt(2))); // min(0.5, ONE)
    expect(sim.world.get(e, Health).hitpoints).toBe(HOUSE_MAX_HP / 2); // 50 of 100 - ramped with built
    // Finish it: Health fills to max.
    fullyHammer(sim, e);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.get(e, Health).hitpoints).toBe(HOUSE_MAX_HP);
  });

  it('keeps a besieged site damaged: the ramp adds the build gain, it never refills the pool', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 }); // fully stocked - only labor gates the rise
    sim.world.add(e, Health, { hitpoints: 1, max: HOUSE_MAX_HP });
    const ctx = ctxOf(sim);
    sim.world.mut(e, UnderConstruction).labor = fx.div(ONE, fx.fromInt(2)); // hammered halfway
    constructionSystem(sim.world, ctx);
    expect(sim.world.get(e, Health).hitpoints).toBe(HOUSE_MAX_HP / 2);

    sim.world.mut(e, Health).hitpoints -= 30; // a besieger's blow lands: 20 of the standing 50 left
    sim.world.mut(e, UnderConstruction).labor = fx.div(fx.fromInt(3), fx.fromInt(4)); // hammered on to 75%
    constructionSystem(sim.world, ctx);

    // The pool gains the 25 hitpoints the rise from 50% to 75% added and keeps the 30 the blow took -
    // resetting it to the ramp would heal a construction site every tick a builder hammers it.
    expect(sim.world.get(e, Health).hitpoints).toBe(45);
  });

  it('never revives a site battered to 0 HP - the ramp leaves it dead for the cleanup pass', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 });
    sim.world.add(e, Health, { hitpoints: 0, max: HOUSE_MAX_HP }); // felled by a swing earlier this tick
    fullyHammer(sim, e); // and complete: neither the ramp nor the finish may raise it
    constructionSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(e, Health).hitpoints).toBe(0);
    expect(sim.world.has(e, UnderConstruction)).toBe(true); // not finished out from under the cleanup pass
  });

  it('clamps each swing at the delivered fraction, so built never jumps at a delivery', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 1 }); // 1 of 3 units on hand
    const ctx = ctxOf(sim);
    // Hammer far more swings than the material on hand backs: labor must stop EXACTLY at the delivered
    // fraction - the truncated per-swing quantum must not park it a hair above (that overshoot is what
    // made `built` visibly jump the instant the next material landed instead of at a swing).
    const delivered = fx.div(ONE, fx.fromInt(3));
    // Far more swings than the 1/3-of-the-build the delivered unit backs (a 3-unit HOUSE is 90 steps
    // total, so 30 one-step novice swings fill the delivered third) - labor must cap.
    const novice = sim.world.create(); // no trade, no tool: one step per swing
    for (let i = 0; i < 40; i++) advanceConstructionLabor(sim.world, ctx, e, novice);
    expect(sim.world.get(e, UnderConstruction).labor).toBe(delivered);
    // More material lands: the cap rises but labor doesn't - built holds until the next swing.
    sim.world.mut(e, Stockpile).amounts.set(STONE, 2);
    constructionSystem(sim.world, ctx);
    expect(sim.world.get(e, Building).built).toBe(delivered);
  });

  it('a swing installs the steps the builder is worth: one bare-handed, four for a master with iron', () => {
    const sim = new Simulation({ seed: 1, content: tooledBuilderContent() });
    const ctx = ctxOf(sim);
    const site = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 }); // 3 units, 90 steps
    const stepLabor = fx.div(ONE, fx.fromInt(90));
    const novice = builderWith(sim, { xp: 0, tool: null });
    advanceConstructionLabor(sim.world, ctx, site, novice);
    expect(sim.world.get(site, UnderConstruction).labor).toBe(stepLabor);
    // 20000 raw XP on the factor-5 track is 200 curve points: 100 percent, four steps with iron.
    const master = builderWith(sim, { xp: 20_000, tool: TOOL_IRON });
    advanceConstructionLabor(sim.world, ctx, site, master);
    expect(sim.world.get(site, UnderConstruction).labor).toBe(fx.mul(stepLabor, fx.fromInt(5)));
  });

  it('discounts live supply runs from the next needed good, spreading fetches over materials', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE); // needs 2 stone + 1 wood, nothing delivered
    const ctx = ctxOf(sim);
    // Empty ledger: stone (2 needed) and wood (1) are both at 0 coverage - the tie keeps the
    // ascending-goodType pick (stone). The tally, reseeded from the live SupplyRun store before each
    // read, must reproduce exactly what a full-store scan would return.
    expect(neededConstructionGoods(sim.world, ctx, e, collectInboundSupply(sim.world))[0]).toEqual({
      goodType: STONE,
      amount: 2,
    });
    // Another settler is already fetching one stone → stone is half covered, wood untouched - the
    // next fetch takes the LEAST-covered line (wood), not a second stone.
    const runner = sim.world.create();
    sim.world.add(runner, SupplyRun, { site: e, goodType: STONE, amount: 1, source: null });
    expect(neededConstructionGoods(sim.world, ctx, e, collectInboundSupply(sim.world))[0]).toEqual({
      goodType: WOOD,
      amount: 1,
    });
    // Every line held or inbound → nothing left to fetch.
    const second = sim.world.create();
    sim.world.add(second, SupplyRun, { site: e, goodType: STONE, amount: 1, source: null });
    const third = sim.world.create();
    sim.world.add(third, SupplyRun, { site: e, goodType: WOOD, amount: 1, source: null });
    expect(neededConstructionGoods(sim.world, ctx, e, collectInboundSupply(sim.world))).toEqual([]);
  });

  it('finishes a free (empty-cost) building immediately - no labor needed', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HEADQUARTERS); // construction cost [] - nothing to hammer in
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(finishedEvents(sim)).toEqual([{ kind: 'buildingFinished', entity: e }]);
    expect(sim.world.has(e, UnderConstruction)).toBe(false);
  });

  it('never revisits an already-built building', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = sim.world.create();
    sim.world.add(e, Building, { buildingType: HOUSE, tribe: VIKING, built: ONE, level: 0 });
    // A built house that happens to hold its materials must NOT re-consume them.
    sim.world.add(e, Stockpile, {
      amounts: new Map<number, number>([
        [STONE, 2],
        [WOOD, 1],
      ]),
    });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(2); // untouched
    expect(finishedEvents(sim)).toHaveLength(0);
  });

  it('is deterministic - two runs from the same seed reach the same finished state', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 7, content: constructionContent() });
      const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 });
      fullyHammer(sim, e);
      constructionSystem(sim.world, ctxOf(sim));
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
