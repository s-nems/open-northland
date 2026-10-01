import { components, fx, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import {
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  GOOD_BREAD,
  GOOD_FLOUR,
  GOOD_WHEAT,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../src/game/sandbox/index.js';
import { SNAPSHOT_SWEEP_INTERVAL_TICKS } from '../src/hud/tool-panel/messages/from-snapshot.js';
import { WORK_STATUS_REASK_SWEEPS } from '../src/hud/tool-panel/messages/work-asks.js';
import { PRODUCTION_STALL_GRACE_TICKS } from '../src/hud/tool-panel/messages/workshop-stalls.js';
import { IDLE_WORK_NAMES, idleWorkBakeryDefinition, idleWorkWorker } from '../src/scenes/idle-work.js';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import type { SceneWorld } from '../src/scenes/types.js';
import { watchStalls } from './support/stall-watch.js';

const SWEEPS_TO_GRACE = PRODUCTION_STALL_GRACE_TICKS / SNAPSHOT_SWEEP_INTERVAL_TICKS;

function registeredScene(id: string): SceneWorld {
  const scene = SCENES.find((s) => s.id === id);
  if (scene === undefined) throw new Error(`${id} scene missing`);
  return scene;
}

function totalOf(sim: Simulation, goodType: number): number {
  let total = 0;
  for (const e of sim.world.query(components.Stockpile)) {
    total += sim.world.get(e, components.Stockpile).amounts.get(goodType) ?? 0;
  }
  return total;
}

/** A staffed mill beside an empty warehouse: no store holds wheat and no farm grows it. */
const MILL_AT = { x: 10, y: 10 } as const;
const MILL_STORE_AT = { x: 18, y: 10 } as const;
const UNSUPPLIED_MILL: SceneWorld = {
  seed: 7,
  terrain: grassTerrain(30, 20),
  build: (sim) => {
    // The mill is enabled by a collector, as in the chain scene.
    spawnSandboxSettler(sim, JOB_COLLECTOR, 2, 2);
    const mill = placeBuiltSandboxBuilding(sim, BUILDING_MILL, MILL_AT.x, MILL_AT.y);
    sim.world.mut(mill, components.Stockpile).amounts.clear();
    spawnWorkersAtDoor(sim, mill, 1);
    const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, MILL_STORE_AT.x, MILL_STORE_AT.y);
    sim.world.mut(store, components.Stockpile).amounts.clear();
  },
};

/** Units of wheat the player brings to the mill's warehouse. */
const DELIVERED_WHEAT = 5;
/** Tiles east of a bakery's worker where a new store goes: well inside its walk range. */
const NEW_STORE_OFFSET = 8;

describe('stalled workshop notes over real runs', () => {
  it('stays silent while the chain fetches from the farm and well and hauls to the store', () => {
    const sim = createSceneSim(registeredScene('chain'));
    sim.run(2);
    // Long enough for the mill and bakery to wait out the farm's first harvest and fill their shelves.
    const { raised } = watchStalls(sim).run(900);
    expect(totalOf(sim, GOOD_FLOUR)).toBeGreaterThan(0);
    expect(totalOf(sim, GOOD_BREAD)).toBeGreaterThan(0);
    expect(raised).toEqual([]);
  });

  it('names the input nothing holds or makes, and retires once a store in reach holds it', () => {
    const sim = createSceneSim(UNSUPPLIED_MILL);
    sim.run(2);
    const watch = watchStalls(sim);
    const blocked = watch.run(SWEEPS_TO_GRACE + 2);
    expect(blocked.standing.map((m) => m.stall)).toEqual([{ reason: 'noInputSource', goodType: GOOD_WHEAT }]);
    const store = [...sim.world.query(components.Building)].find(
      (e) => sim.world.get(e, components.Building).buildingType === BUILDING_WAREHOUSE_00,
    );
    if (store === undefined) throw new Error('no warehouse');
    sim.world.mut(store, components.Stockpile).amounts.set(GOOD_WHEAT, DELIVERED_WHEAT);
    expect(watch.run(WORK_STATUS_REASK_SWEEPS).standing).toEqual([]);
    watch.run(SWEEPS_TO_GRACE);
    expect(totalOf(sim, GOOD_FLOUR)).toBeGreaterThan(0);
  });

  it('names the out-of-reach stores of store-reach, and retires each once a store stands in reach', () => {
    const sim = createSceneSim(registeredScene('store-reach'));
    sim.run(2);
    const watch = watchStalls(sim);
    const blocked = watch.run(SWEEPS_TO_GRACE + 2);
    expect(blocked.standing.map((m) => m.stall?.reason).sort()).toEqual([
      'inputOutOfReach',
      'outputOutOfReach',
    ]);
    // The empty bakery gets a stocked store beside it, the full one an empty store.
    const bakery = idleWorkBakeryDefinition(sim);
    const inputs = bakery.recipes[0]?.inputs ?? [];
    const storeBeside = (name: string): Map<number, number> => {
      const worker = idleWorkWorker(sim, name);
      if (worker === undefined) throw new Error(`no ${name}`);
      const at = sim.world.get(worker, components.Position);
      const x = fx.toInt(at.x) + NEW_STORE_OFFSET;
      const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, x, fx.toInt(at.y));
      const shelf = sim.world.mut(store, components.Stockpile).amounts;
      shelf.clear();
      return shelf;
    };
    const stocked = storeBeside(IDLE_WORK_NAMES.ingredients);
    for (const input of inputs) stocked.set(input.goodType, DELIVERED_WHEAT);
    storeBeside(IDLE_WORK_NAMES.storage);
    expect(watch.run(WORK_STATUS_REASK_SWEEPS).standing).toEqual([]);
  });
});
