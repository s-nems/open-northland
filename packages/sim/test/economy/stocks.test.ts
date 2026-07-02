import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Building, Stockpile } from '../../src/components/index.js';
import { ONE, Simulation } from '../../src/index.js';
import { tribeStocks } from '../../src/systems/index.js';

/**
 * The stocks read model — `tribeStocks` sums each good a tribe holds across all its stores (any
 * `Building` carrying a `Stockpile`). It is the goods half of the HUD read model (`tribePopulation`
 * is the population half): a pure, deterministic derived view, no mechanic added. Determinism is
 * covered by the addition-commutes argument (a sum is order-independent); these tests pin the
 * aggregation: cross-store summing, per-tribe isolation, and the empty cases.
 */

const VIKING = 1;
const OTHER_TRIBE = 2;
const WOOD = 5;
const PLANK = 2;
const STONE = 7;

// parseContentSet only requires goods/jobs/buildings; the rest default. The read model reads world
// state (Building.tribe + Stockpile.amounts), not content, so the building types here are nominal.
function stocksContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: PLANK, id: 'plank' },
      { typeId: WOOD, id: 'wood' },
      { typeId: STONE, id: 'stone' },
    ],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'warehouse', kind: 'headquarters' }],
  });
}

beforeEach(() => {
  Building.store.clear();
  Stockpile.store.clear();
});

function placeStore(sim: Simulation, tribe: number, amounts: Map<number, number>): void {
  const e = sim.world.create();
  sim.world.add(e, Building, { buildingType: 1, tribe, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts });
}

describe('tribeStocks', () => {
  it('is empty for a tribe with no stores', () => {
    const sim = new Simulation({ seed: 1, content: stocksContent() });
    expect([...tribeStocks(sim.world, VIKING).entries()]).toEqual([]);
  });

  it('sums a single store’s goods', () => {
    const sim = new Simulation({ seed: 1, content: stocksContent() });
    placeStore(
      sim,
      VIKING,
      new Map([
        [WOOD, 12],
        [PLANK, 3],
      ]),
    );
    const stocks = tribeStocks(sim.world, VIKING);
    expect(stocks.get(WOOD)).toBe(12);
    expect(stocks.get(PLANK)).toBe(3);
    expect(stocks.get(STONE)).toBeUndefined(); // a good held nowhere is absent
  });

  it('totals a good across multiple stores', () => {
    const sim = new Simulation({ seed: 1, content: stocksContent() });
    placeStore(sim, VIKING, new Map([[WOOD, 12]]));
    placeStore(sim, VIKING, new Map([[WOOD, 8]])); // a second warehouse also holding wood
    placeStore(
      sim,
      VIKING,
      new Map([
        [WOOD, 5],
        [PLANK, 4],
      ]),
    );
    const stocks = tribeStocks(sim.world, VIKING);
    expect(stocks.get(WOOD)).toBe(25); // 12 + 8 + 5
    expect(stocks.get(PLANK)).toBe(4);
  });

  it('is per-tribe — another tribe’s stock is not counted', () => {
    const sim = new Simulation({ seed: 1, content: stocksContent() });
    placeStore(sim, VIKING, new Map([[WOOD, 10]]));
    placeStore(sim, OTHER_TRIBE, new Map([[WOOD, 99]]));
    expect(tribeStocks(sim.world, VIKING).get(WOOD)).toBe(10);
    expect(tribeStocks(sim.world, OTHER_TRIBE).get(WOOD)).toBe(99);
    expect([...tribeStocks(sim.world, 42).entries()]).toEqual([]); // an absent tribe
  });

  it('keeps a real zero-stock entry a store carries (empty capacity, not absent)', () => {
    const sim = new Simulation({ seed: 1, content: stocksContent() });
    placeStore(sim, VIKING, new Map([[WOOD, 0]])); // a slot with capacity but nothing in it
    const stocks = tribeStocks(sim.world, VIKING);
    expect(stocks.get(WOOD)).toBe(0); // present as 0, not undefined — a consumer filters if it wants
  });
});
