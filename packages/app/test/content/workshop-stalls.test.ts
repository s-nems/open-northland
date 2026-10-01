import { components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../src/catalog/buildings.js';
import { JOB_COLLECTOR } from '../../src/catalog/jobs.js';
import {
  BUILDING_BAKERY,
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_MASON_HUT,
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  BUILDING_WELL,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import type { SceneWorld } from '../../src/scenes/types.js';
import { watchStalls } from '../support/stall-watch.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/** The real goods the run checks (`goods.ini` typeIds). */
const GOOD_STONE = 3;
const GOOD_FLOUR = 11;
const GOOD_BREAD = 19;
const GOOD_PILLAR = 26;
/** Stone the headquarters holds for the mason. */
const STOCKED_STONE = 40;
const FARMERS = 2;
/** Sweeps of a second each: past the farm's first harvest and every shelf filling to capacity. */
const RUN_SWEEPS = 1700;

/**
 * The owner's case: a mason's hut beside the headquarters with stone in it, and a farm, mill, well and
 * bakery side by side with a warehouse, every workshop starting empty.
 */
const ECONOMY: SceneWorld = {
  seed: 15,
  terrain: grassTerrain(60, 34),
  build: (sim) => {
    spawnSandboxSettler(sim, JOB_COLLECTOR, 2, 2);
    const headquarters = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, 10, 8);
    const stock = sim.world.mut(headquarters, components.Stockpile).amounts;
    stock.clear();
    stock.set(GOOD_STONE, STOCKED_STONE);
    placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 37, 22);
    for (const [type, x, y, crew] of [
      [BUILDING_MASON_HUT, 19, 8, 1],
      [BUILDING_FARM, 10, 22, FARMERS],
      [BUILDING_MILL, 19, 22, 1],
      [BUILDING_BAKERY, 28, 22, 1],
      [BUILDING_WELL, 28, 15, 1],
    ] as const) {
      const building = placeBuiltSandboxBuilding(sim, type, x, y);
      sim.world.mut(building, components.Stockpile).amounts.clear();
      spawnWorkersAtDoor(sim, building, crew);
    }
  },
};

function totalOf(sim: Simulation, goodType: number): number {
  let total = 0;
  for (const e of sim.world.query(components.Stockpile)) {
    total += sim.world.get(e, components.Stockpile).amounts.get(goodType) ?? 0;
  }
  return total;
}

describe.runIf(hasRealIr())('stalled workshop notes on real content', () => {
  it('stay silent while operators fetch from the farm and well and carry to the stores', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(ECONOMY, { content: merge.content });
    sim.run(2);
    const { raised } = watchStalls(sim).run(RUN_SWEEPS);
    for (const good of [GOOD_PILLAR, GOOD_FLOUR, GOOD_BREAD]) expect(totalOf(sim, good)).toBeGreaterThan(0);
    expect(raised).toEqual([]);
  });
});
