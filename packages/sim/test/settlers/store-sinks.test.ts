import { describe, expect, it } from 'vitest';
import {
  Building,
  DeliveryFlag,
  GroundDrop,
  setStockAmount,
  UnderConstruction,
  Upgrading,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { StoreSinks } from '../../src/systems/settlers/targets/stores/sinks.js';
import { HOME_L0, levelChainContent, placeBuiltHome, STONE } from '../economy/construction-system/support.js';
import {
  BREAD,
  buildingAt,
  ctxOf,
  FARM,
  GRANARY,
  grassMap,
  HEADQUARTERS,
  KITCHEN,
  PLANK,
  pileAt,
  WHEAT,
  WOOD,
} from '../economy/producer-supply/support.js';
import { testContent } from '../fixtures/content.js';

/** testContent's HQ wood slot. */
const HQ_WOOD_CAPACITY = 150;
const ORDINARY = false;
const STORAGE_ONLY = true;

function sinksOf(sim: Simulation, goodType: number, excludeProducers = ORDINARY): Entity[] {
  return [...StoreSinks.of(sim.world, ctxOf(sim)).sinks(goodType, excludeProducers)].sort((a, b) => a - b);
}

describe('StoreSinks - the per-good delivery sink ledger kept across ticks', () => {
  it('files each store under the goods canStoreGood lets it take, per producer mode', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
    const hq = buildingAt(sim, HEADQUARTERS, 1, 0);
    const kitchen = buildingAt(sim, KITCHEN, 4, 0); // wood in, bread out
    const farm = buildingAt(sim, FARM, 7, 0); // produces wheat
    const granary = buildingAt(sim, GRANARY, 10, 0);

    expect(sinksOf(sim, WOOD)).toEqual([hq, kitchen]);
    // The HQ has no bread slot but banks it as its edible form; the kitchen never takes back its output.
    expect(sinksOf(sim, BREAD)).toEqual([hq]);
    expect(sinksOf(sim, WHEAT)).toEqual([farm, granary]);
    expect(sinksOf(sim, WHEAT, STORAGE_ONLY)).toEqual([granary]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('follows stock writes, structure changes and destroyed stores without drifting', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
    const hq = buildingAt(sim, HEADQUARTERS, 1, 0);
    const granary = buildingAt(sim, GRANARY, 10, 0);
    expect(sinksOf(sim, WOOD)).toEqual([hq]);

    setStockAmount(sim.world, hq, WOOD, HQ_WOOD_CAPACITY);
    expect(sinksOf(sim, WOOD)).toEqual([]);
    setStockAmount(sim.world, hq, WOOD, 0);
    sim.world.add(hq, UnderConstruction, { labor: fx.fromInt(0) });
    expect(sinksOf(sim, WOOD)).toEqual([]);
    sim.world.remove(hq, UnderConstruction);
    expect(sinksOf(sim, WOOD)).toEqual([hq]);

    sim.world.destroy(granary);
    expect(sinksOf(sim, WHEAT)).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('takes any good into an empty flag pile, only its own good once stocked, and never a ground drop', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
    const flag = pileAt(sim, 2, 0);
    sim.world.add(flag, DeliveryFlag, {});
    const drop = pileAt(sim, 5, 0);
    sim.world.add(drop, GroundDrop, { goodType: WOOD });
    expect(sinksOf(sim, WOOD)).toEqual([flag]);
    expect(sinksOf(sim, PLANK)).toEqual([flag]);

    setStockAmount(sim.world, flag, WOOD, 2);
    expect(sinksOf(sim, WOOD)).toEqual([flag]);
    expect(sinksOf(sim, PLANK)).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it("slots an unfinished upgrade by the next tier's bill", () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent(), map: grassMap(4, 4) });
    const home = placeBuiltHome(sim, HOME_L0, 0);
    sim.world.mut(home, Building).built = fx.fromInt(0);
    sim.world.add(home, Upgrading, { savedStock: new Map(), seeded: new Map() });

    expect(sinksOf(sim, STONE)).toEqual([home]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
