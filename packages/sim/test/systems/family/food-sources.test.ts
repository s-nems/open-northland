import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Owner,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../src/components/index.js';
import { GENERATION_JOURNAL_LIMIT } from '../../../src/ecs/generation-journal.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, Simulation } from '../../../src/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import { ExternalFoodIndex } from '../../../src/systems/family/food-search.js';
import { foodSourcesOf } from '../../../src/systems/family/food-sources.js';
import { collectSupplyTally, setAccessibleStockAmount } from '../../../src/systems/stores/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

/**
 * The family food-source set held across ticks (`systems/family/food-sources.ts`): a read catches up from
 * the journaled stock, building and upgrade changes instead of re-filtering every store, and the
 * registered verifier re-derives it.
 */

const WOOD = 1;
const FOOD = 16; // `food_simple`: the `food_` prefix is what makes it edible
const FOOD_EXTRA = 17;
/** A dish (`readviews/food.ts`): a family lifts it as `food_simple`. */
const MEAT = 21;
const LARDER_SLOT = 5;
const HOME = 2;
const WAREHOUSE = 7;
/** The animal farm, whose slaughter lands meat on its shelf. */
const ANIMAL_FARM = 17;
const VIKING = 1;

function foodContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood' },
      { typeId: FOOD, id: 'food_simple' },
      { typeId: FOOD_EXTRA, id: 'food_extra' },
      { typeId: MEAT, id: 'meat' },
    ],
    jobs: [],
    landscape: [],
    tribes: [],
    buildings: [
      {
        typeId: HOME,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 3,
        stock: [
          { goodType: FOOD, capacity: LARDER_SLOT },
          { goodType: FOOD_EXTRA, capacity: LARDER_SLOT },
        ],
      },
      {
        typeId: WAREHOUSE,
        id: 'warehouse',
        kind: 'storage',
        stock: [
          { goodType: FOOD, capacity: 99 },
          { goodType: FOOD_EXTRA, capacity: 99 },
        ],
      },
      {
        typeId: ANIMAL_FARM,
        id: 'animal_farm',
        kind: 'workplace',
        stock: [{ goodType: MEAT, capacity: 30 }],
      },
    ],
  });
}

function storeAt(sim: Simulation, hx: number, good: number, amount: number, buildingType?: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, 2));
  if (buildingType !== undefined) {
    sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  }
  sim.world.add(e, Stockpile, { amounts: new Map([[good, amount]]) });
  return e;
}

/** Stock written behind the journals: a catch-up skips it, only a full re-capture sees it. */
function setUnjournaled(sim: Simulation, store: Entity, good: number, amount: number): void {
  (sim.world.get(store, Stockpile).amounts as Map<number, number>).set(good, amount);
}

describe('foodSourcesOf', () => {
  it('protects edible production inputs when choosing food for a home, including mixed stocks', () => {
    const base = foodContent();
    const processor = 91;
    const content = parseContentSet({
      ...base,
      buildings: [
        ...base.buildings,
        {
          typeId: processor,
          id: 'food_processor',
          kind: 'workplace',
          stock: [
            { goodType: FOOD, capacity: 5 },
            { goodType: FOOD_EXTRA, capacity: 5 },
          ],
          recipes: [
            {
              inputs: [{ goodType: FOOD, amount: 1 }],
              outputs: [{ goodType: FOOD_EXTRA, amount: 1 }],
              ticks: 20,
            },
          ],
        },
      ],
    });
    const sim = new Simulation({ seed: 1, content });
    const workshop = storeAt(sim, 1, FOOD, 3, processor);
    const warehouse = storeAt(sim, 8, FOOD, 2, WAREHOUSE);
    const home = storeAt(sim, 0, FOOD, 0, HOME);
    const pick = () =>
      new ExternalFoodIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world)).nearest(
        { hx: 0, hy: 2 },
        undefined,
        home,
        null,
      );
    expect(foodSourcesOf(sim.world, content).candidates).toEqual([warehouse]);
    expect(pick()).toEqual({ store: warehouse, goodType: FOOD });
    sim.world.mut(workshop, Stockpile).amounts.set(FOOD_EXTRA, 1);
    expect(pick()).toEqual({ store: workshop, goodType: FOOD_EXTRA });
    sim.world.mut(workshop, Building).buildingType = WAREHOUSE;
    expect(pick()).toEqual({ store: workshop, goodType: FOOD });
    sim.world.mut(workshop, Building).buildingType = processor;
    expect(pick()).toEqual({ store: workshop, goodType: FOOD_EXTRA });
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('leaves out a home larder, a site hold and a destroyed store, and counts an upgrade inventory', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const home = storeAt(sim, 1, FOOD, 2, HOME);
    const warehouse = storeAt(sim, 2, FOOD, 2, WAREHOUSE);
    const site = storeAt(sim, 3, FOOD, 2, WAREHOUSE);
    const heap = storeAt(sim, 4, FOOD, 2);
    expect(foodSourcesOf(sim.world, sim.content).candidates).toEqual([warehouse, site, heap]);

    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.destroy(heap);
    sim.world.add(warehouse, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(warehouse, Upgrading, {
      target: sim.world.get(warehouse, Building).buildingType,
      savedStock: new Map([[FOOD, 1]]),
      seeded: new Map(),
    });
    sim.world.mut(warehouse, Stockpile).amounts.clear(); // the build hold, now empty
    sim.world.mut(home, Building).buildingType = WAREHOUSE;
    expect(foodSourcesOf(sim.world, sim.content).candidates).toEqual([home, warehouse]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('admits an upgrading store when food lands in its saved inventory', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const warehouse = storeAt(sim, 1, WOOD, 1, WAREHOUSE);
    sim.world.add(warehouse, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(warehouse, Upgrading, {
      target: sim.world.get(warehouse, Building).buildingType,
      savedStock: new Map([[WOOD, 1]]),
      seeded: new Map(),
    });
    expect(foodSourcesOf(sim.world, sim.content).candidates).toEqual([]);
    setAccessibleStockAmount(sim.world, warehouse, FOOD, 1);
    expect(foodSourcesOf(sim.world, sim.content).candidates).toEqual([warehouse]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('re-captures every store when the churn outruns the journal window', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const wood = storeAt(sim, 1, WOOD, 1);
    const hidden = storeAt(sim, 2, WOOD, 1);
    foodSourcesOf(sim.world, sim.content);
    for (let i = 0; i <= GENERATION_JOURNAL_LIMIT; i++) sim.world.mut(wood, Stockpile).amounts.set(WOOD, i);
    sim.world.mut(wood, Stockpile).amounts.set(FOOD, 1);
    setUnjournaled(sim, hidden, FOOD, 1);
    expect(foodSourcesOf(sim.world, sim.content).candidates).toEqual([wood, hidden]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('picks the nearest source a seeker may use, by ring or by scan, as a full scan does', () => {
    const SEEKER = 0;
    const RIVAL = 1;
    const SPREAD_NODES = 300;
    // About half are the rival's: the larger count leaves the seeker's side past the ring threshold.
    for (const count of [100, 700]) {
      const sim = new Simulation({ seed: 1, content: foodContent() });
      const home = storeAt(sim, 0, FOOD, 0, HOME);
      let state = count;
      const next = (bound: number): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state % bound;
      };
      const stores: { e: Entity; hx: number; hy: number; usable: boolean }[] = [];
      for (let i = 0; i < count; i++) {
        const hx = next(SPREAD_NODES);
        const hy = next(SPREAD_NODES);
        const e = sim.world.create();
        sim.world.add(e, Position, positionOfNode(hx, hy));
        sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, 1]]) });
        const rival = next(2) === 0;
        if (rival) sim.world.add(e, Owner, { player: RIVAL });
        stores.push({ e, hx, hy, usable: !rival });
      }
      const index = new ExternalFoodIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world));
      for (let q = 0; q < 40; q++) {
        const from = { hx: next(SPREAD_NODES), hy: next(SPREAD_NODES) };
        let best: { e: Entity; d: number } | null = null;
        for (const { e, hx, hy, usable } of stores) {
          const d = Math.abs(hx - from.hx) + Math.abs(hy - from.hy);
          if (usable && (best === null || d < best.d || (d === best.d && e < best.e))) best = { e, d };
        }
        expect(index.nearest(from, SEEKER, home, null)?.store).toBe(best?.e);
      }
    }
  });

  it('sees a store change sides between searches, beside the neutral ones', () => {
    const SEEKER = 0;
    const RIVAL = 1;
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const home = storeAt(sim, 0, FOOD, 0, HOME);
    const near = storeAt(sim, 1, FOOD, 3, WAREHOUSE);
    sim.world.add(near, Owner, { player: RIVAL });
    const neutral = storeAt(sim, 5, FOOD, 3, WAREHOUSE);
    const from = { hx: 0, hy: 2 };
    const search = (): Entity | undefined =>
      new ExternalFoodIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world)).nearest(
        from,
        SEEKER,
        home,
        null,
      )?.store;

    expect(search()).toBe(neutral);
    sim.world.mut(near, Owner).player = SEEKER;
    expect(search()).toBe(near);
    sim.world.remove(near, Owner);
    expect(search()).toBe(near);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it("offers only a food the seeker's larder has room for", () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const home = storeAt(sim, 9, FOOD, LARDER_SLOT, HOME); // the `food_simple` slot is full
    const near = storeAt(sim, 1, FOOD, 3, WAREHOUSE);
    const far = storeAt(sim, 5, FOOD, 3, WAREHOUSE);
    sim.world.mut(far, Stockpile).amounts.set(FOOD_EXTRA, 1);
    const from = { hx: 0, hy: 2 };
    const search = (): ReturnType<ExternalFoodIndex['nearest']> =>
      new ExternalFoodIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world)).nearest(
        from,
        undefined,
        home,
        null,
      );

    expect(search()).toEqual({ store: far, goodType: FOOD_EXTRA });
    sim.world.mut(home, Stockpile).amounts.set(FOOD_EXTRA, LARDER_SLOT);
    expect(search()).toBeNull();
    sim.world.mut(home, Stockpile).amounts.set(FOOD, LARDER_SLOT - 1);
    expect(search()).toEqual({ store: near, goodType: FOOD });
  });

  it("takes meat before a nearer store's food, while it is hers and unclaimed", () => {
    const SEEKER = 0;
    const RIVAL = 1;
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const home = storeAt(sim, 0, FOOD, 0, HOME);
    const near = storeAt(sim, 1, FOOD, 3, WAREHOUSE);
    const farm = storeAt(sim, 9, MEAT, 1, ANIMAL_FARM);
    sim.world.add(farm, Owner, { player: SEEKER });
    const supply = collectSupplyTally(sim.world);
    const search = (): ReturnType<ExternalFoodIndex['nearest']> =>
      new ExternalFoodIndex(sim.world, ctxOf(sim), undefined, supply).nearest(
        { hx: 0, hy: 2 },
        SEEKER,
        home,
        null,
      );

    expect(search()).toEqual({ store: farm, goodType: MEAT });
    sim.world.mut(farm, Owner).player = RIVAL;
    expect(search()).toEqual({ store: near, goodType: FOOD });
    expect(sim.world.verifyCaches()).toEqual([]);
    sim.world.mut(farm, Owner).player = SEEKER;
    supply.stampPickupClaim(sim.world.create(), { source: farm, goodType: MEAT, amount: 1 });
    expect(search()).toEqual({ store: near, goodType: FOOD });
    expect(sim.world.verifyCaches()).toEqual([]);
    // Drained of meat but still holding food, the farm stays a source and leaves the meat list.
    setAccessibleStockAmount(sim.world, farm, FOOD, 1);
    setAccessibleStockAmount(sim.world, farm, MEAT, 0);
    expect(foodSourcesOf(sim.world, sim.content).candidates).toContain(farm);
    expect(foodSourcesOf(sim.world, sim.content).meatOn(SEEKER)).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('passes over a pile a placement displaced after the pass caught its sources up', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const home = storeAt(sim, 0, FOOD, 0, HOME);
    const pile = storeAt(sim, 2, FOOD, 3);
    const far = storeAt(sim, 9, FOOD, 3, WAREHOUSE);
    const index = new ExternalFoodIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world));
    // A footprint eviction re-creates the pile under a new id the held pass does not list.
    sim.world.destroy(pile);
    storeAt(sim, 3, FOOD, 3);

    expect(index.nearest({ hx: 0, hy: 2 }, undefined, home, null)).toEqual({ store: far, goodType: FOOD });
  });

  it('verifier reports a stock change that bypassed the mut seam', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const wood = storeAt(sim, 1, WOOD, 1);
    expect(foodSourcesOf(sim.world, sim.content).candidates).toEqual([]);
    setUnjournaled(sim, wood, FOOD, 1);
    expect(sim.world.verifyCaches()).toEqual(['familyFoodSources disagree with a fresh store scan']);
  });
});
