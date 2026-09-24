import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Position, Stockpile, UnderConstruction, Upgrading } from '../../src/components/index.js';
import { GENERATION_JOURNAL_LIMIT } from '../../src/ecs/generation-journal.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { ExternalFoodIndex } from '../../src/systems/family/food-search.js';
import { foodSourcesOf } from '../../src/systems/family/food-sources.js';
import { setAccessibleStockAmount } from '../../src/systems/stores/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The family food-source set held across ticks (`systems/family/food-sources.ts`): a read catches up from
 * the journaled stock, building and upgrade changes instead of re-filtering every store, and the
 * registered verifier re-derives it.
 */

const WOOD = 1;
const FOOD = 16; // `food_simple`: the `food_` prefix is what makes it edible
const HOME = 2;
const WAREHOUSE = 7;
const VIKING = 1;
const FOOD_FREE_STORES = 200;

function foodContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood' },
      { typeId: FOOD, id: 'food_simple' },
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
        stock: [{ goodType: FOOD, capacity: 5 }],
      },
      { typeId: WAREHOUSE, id: 'warehouse', kind: 'storage', stock: [{ goodType: FOOD, capacity: 99 }] },
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
  it('catches up only the stores whose journaled inputs changed', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const woodStores: Entity[] = [];
    for (let i = 0; i < FOOD_FREE_STORES; i++) woodStores.push(storeAt(sim, i, WOOD, 3));
    const pantry = storeAt(sim, FOOD_FREE_STORES, FOOD, 2);
    const sources = foodSourcesOf(sim.world, sim.content);
    expect(sources.candidates).toEqual([pantry]);
    sim.step();

    const stocked = woodStores[1] as Entity;
    const hidden = woodStores[2] as Entity;
    sim.world.mut(stocked, Stockpile).amounts.set(FOOD, 1);
    sim.world.mut(pantry, Stockpile).amounts.set(FOOD, 0);
    setUnjournaled(sim, hidden, FOOD, 1);
    expect(foodSourcesOf(sim.world, sim.content)).toBe(sources);
    expect(sources.candidates).toEqual([stocked]); // `hidden` shows a full re-capture never ran
    setUnjournaled(sim, hidden, FOOD, 0);
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
    sim.world.add(warehouse, Upgrading, { savedStock: new Map([[FOOD, 1]]), seeded: new Map() });
    sim.world.mut(warehouse, Stockpile).amounts.clear(); // the build hold, now empty
    sim.world.mut(home, Building).buildingType = WAREHOUSE;
    expect(foodSourcesOf(sim.world, sim.content).candidates).toEqual([home, warehouse]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('admits an upgrading store when food lands in its saved inventory', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const warehouse = storeAt(sim, 1, WOOD, 1, WAREHOUSE);
    sim.world.add(warehouse, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(warehouse, Upgrading, { savedStock: new Map([[WOOD, 1]]), seeded: new Map() });
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

  it('holds still for the pass that caught it up', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const wood = storeAt(sim, 1, WOOD, 1);
    const from = { hx: 0, hy: 2 };
    const pass = new ExternalFoodIndex(sim.world, ctxOf(sim), undefined);
    sim.world.mut(wood, Stockpile).amounts.set(FOOD, 1); // a drop later in the same pass
    expect(pass.nearest(from, undefined, null)).toBeNull();
    const next = new ExternalFoodIndex(sim.world, ctxOf(sim), undefined);
    expect(next.nearest(from, undefined, null)).toEqual({ store: wood, goodType: FOOD });
  });

  it('verifier reports a stock change that bypassed the mut seam', () => {
    const sim = new Simulation({ seed: 1, content: foodContent() });
    const wood = storeAt(sim, 1, WOOD, 1);
    expect(foodSourcesOf(sim.world, sim.content).candidates).toEqual([]);
    setUnjournaled(sim, wood, FOOD, 1);
    expect(sim.world.verifyCaches()).toEqual(['familyFoodSources disagree with a fresh store scan']);
  });
});
