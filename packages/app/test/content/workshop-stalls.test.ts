import { components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../src/catalog/buildings.js';
import { JOB_CARRIER, JOB_COLLECTOR } from '../../src/catalog/jobs.js';
import {
  BUILDING_BAKERY,
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_JOINERY,
  BUILDING_MASON_HUT,
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  BUILDING_WELL,
  GATHERERS,
  placeBuiltSandboxBuilding,
  placeResourceNode,
  placeSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../../src/game/sandbox/index.js';
import { SNAPSHOT_SWEEP_INTERVAL_TICKS } from '../../src/hud/tool-panel/messages/from-snapshot.js';
import { PRODUCTION_STALL_GRACE_TICKS } from '../../src/hud/tool-panel/messages/workshop-stalls.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import type { SceneWorld } from '../../src/scenes/types.js';
import { watchStalls } from '../support/stall-watch.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/** The real goods the run checks (`goods.ini` typeIds). */
const GOOD_STONE = 3;
const GOOD_WHEAT = 4;
const GOOD_FLOUR = 11;
const GOOD_BREAD = 19;
const GOOD_WOOD = 5;
const GOOD_PILLAR = 26;
const GOOD_TOOL_WOODEN = 31;
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

const JOINERY_AT = { x: 10, y: 12 } as const;
const JOINERY_STORE_AT = { x: 14, y: 18 } as const;
/** A grove about 24 cells east of the joinery: a collector's walk out, felling and walk back. */
const GROVE_X = 34;
const GROVE_ROWS = [8, 10, 12, 14, 16] as const;
/** Sweeps of a second each: past the collector's first trips and the joiner's first tools. */
const JOINERY_RUN_SWEEPS = 300;

/**
 * A joinery staffed by a joiner and its own collector beside an empty warehouse, with nothing of wood
 * stocked anywhere: the collector's fellings are the joiner's only wood.
 */
const SELF_SUPPLIED_JOINERY: SceneWorld = {
  seed: 23,
  terrain: grassTerrain(50, 30),
  build: (sim) => {
    const joinery = placeBuiltSandboxBuilding(sim, BUILDING_JOINERY, JOINERY_AT.x, JOINERY_AT.y);
    sim.world.mut(joinery, components.Stockpile).amounts.clear();
    spawnWorkersAtDoor(sim, joinery, 1);
    spawnWorkersAtDoor(sim, joinery, 1, { jobType: JOB_COLLECTOR });
    const store = placeBuiltSandboxBuilding(
      sim,
      BUILDING_WAREHOUSE_00,
      JOINERY_STORE_AT.x,
      JOINERY_STORE_AT.y,
    );
    sim.world.mut(store, components.Stockpile).amounts.clear();
    const wood = GATHERERS.find((g) => g.good === GOOD_WOOD);
    if (wood === undefined) throw new Error('no wood gatherer spec');
    for (const y of GROVE_ROWS) placeResourceNode(sim, wood, GROVE_X, y);
  },
};

/** A staffed joinery beside an empty warehouse, with no collector anywhere. */
const UNGATHERED_JOINERY: SceneWorld = {
  seed: 23,
  terrain: grassTerrain(30, 24),
  build: (sim) => {
    const joinery = placeBuiltSandboxBuilding(sim, BUILDING_JOINERY, JOINERY_AT.x, JOINERY_AT.y);
    sim.world.mut(joinery, components.Stockpile).amounts.clear();
    spawnWorkersAtDoor(sim, joinery, 1);
    const store = placeBuiltSandboxBuilding(
      sim,
      BUILDING_WAREHOUSE_00,
      JOINERY_STORE_AT.x,
      JOINERY_STORE_AT.y,
    );
    sim.world.mut(store, components.Stockpile).amounts.clear();
  },
};

/** A mill beside an empty warehouse and a farm staffed only by its carrier: nobody grows wheat. */
const CARRIER_ONLY_FARM: SceneWorld = {
  seed: 12,
  terrain: grassTerrain(40, 24),
  build: (sim) => {
    const farm = placeBuiltSandboxBuilding(sim, BUILDING_FARM, 8, 10);
    sim.world.mut(farm, components.Stockpile).amounts.clear();
    spawnWorkersAtDoor(sim, farm, 1, { jobType: JOB_CARRIER });
    const mill = placeBuiltSandboxBuilding(sim, BUILDING_MILL, 18, 10);
    sim.world.mut(mill, components.Stockpile).amounts.clear();
    spawnWorkersAtDoor(sim, mill, 1);
    const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 26, 10);
    sim.world.mut(store, components.Stockpile).amounts.clear();
  },
};

/** Sweeps past the stall grace and the first ask's answer. */
const BLOCKED_SWEEPS = PRODUCTION_STALL_GRACE_TICKS / SNAPSHOT_SWEEP_INTERVAL_TICKS + 2;

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

  it('stay silent while the joinery collector fells the wood the joiner needs', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(SELF_SUPPLIED_JOINERY, { content: merge.content });
    sim.run(2);
    const { raised } = watchStalls(sim).run(JOINERY_RUN_SWEEPS);
    expect(totalOf(sim, GOOD_TOOL_WOODEN)).toBeGreaterThan(0);
    expect(raised).toEqual([]);
  });

  it('point a joinery nobody gathers wood for at gatherers', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(UNGATHERED_JOINERY, { content: merge.content });
    sim.run(2);
    const { standing } = watchStalls(sim).run(BLOCKED_SWEEPS);
    expect(standing.map((m) => m.stall)).toEqual([{ reason: 'noGatherer', goodType: GOOD_WOOD }]);
  });

  it('count no farm staffed only by its carrier as the mill wheat source', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(CARRIER_ONLY_FARM, { content: merge.content });
    sim.run(2);
    const { standing } = watchStalls(sim).run(BLOCKED_SWEEPS);
    expect(standing.map((m) => m.stall)).toEqual([{ reason: 'noInputSource', goodType: GOOD_WHEAT }]);
  });
});
