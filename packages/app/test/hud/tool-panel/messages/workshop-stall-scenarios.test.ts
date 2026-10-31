import { components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../../../src/catalog/buildings.js';
import { JOB_COLLECTOR } from '../../../../src/catalog/jobs.js';
import {
  BUILDING_BAKERY,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  GOOD_BREAD,
  GOOD_FLOUR,
  GOOD_WHEAT,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../../../../src/game/sandbox/index.js';
import { SNAPSHOT_SWEEP_INTERVAL_TICKS } from '../../../../src/hud/tool-panel/messages/from-snapshot.js';
import { STORAGE_FULL_GRACE_TICKS } from '../../../../src/hud/tool-panel/messages/storage-full.js';
import { WORK_STATUS_REASK_SWEEPS } from '../../../../src/hud/tool-panel/messages/work-asks.js';
import { PRODUCTION_STALL_GRACE_TICKS } from '../../../../src/hud/tool-panel/messages/workshop-stalls.js';
import {
  IDLE_WORK_NAMES,
  idleWorkBakeryDefinition,
  idleWorkWorker,
} from '../../../../src/scenes/economy/idle-work.js';
import { createSceneSim } from '../../../../src/scenes/index.js';
import type { SceneWorld } from '../../../../src/scenes/types.js';
import { registeredScene } from '../../../support/sandbox.js';
import { totalOf, watchStalls } from '../../../support/stall-watch.js';

const SWEEPS_TO_GRACE = PRODUCTION_STALL_GRACE_TICKS / SNAPSHOT_SWEEP_INTERVAL_TICKS;
const SWEEPS_TO_STORAGE_GRACE = STORAGE_FULL_GRACE_TICKS / SNAPSHOT_SWEEP_INTERVAL_TICKS;

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
/** Sweeps past the chain's first bread, about 230 sweeps in: the mill and bakery wait out the farm's
 *  first harvest, far longer than the stall grace, before any input reaches them. */
const CHAIN_RUN_SWEEPS = 300;

describe('stalled workshop notes over real runs', () => {
  it('stays silent while the chain fetches from the farm and well and hauls to the store', () => {
    const sim = createSceneSim(registeredScene('chain'));
    sim.run(2);
    const { raised } = watchStalls(sim).run(CHAIN_RUN_SWEEPS);
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
      const worker = idleWorkWorker(name);
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

/** The bakery's bread shelf, full from the start. */
const BAKERY_SHELF = 20;

/** Where the home beside the full headquarters stands, when there is one. */
const HOME_AT = { x: 24, y: 18 } as const;

/** A staffed bakery with a full bread shelf beside a headquarters with every slot full, and optionally an
 *  empty home that takes food: `storage-full` with its home emptied or left out. */
function fullHeadquarters(withHome: boolean): {
  scene: SceneWorld;
  headquarters: () => number;
  home: () => number;
} {
  let headquarters = -1;
  let home = -1;
  return {
    headquarters: () => headquarters,
    home: () => home,
    scene: {
      seed: 7,
      terrain: grassTerrain(40, 24),
      build: (sim) => {
        spawnSandboxSettler(sim, JOB_COLLECTOR, 2, 2);
        const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, 24, 10);
        headquarters = hq;
        const slots = sim.content.buildings.find((b) => b.typeId === BUILDING_HEADQUARTERS)?.stock ?? [];
        const shelf = sim.world.mut(hq, components.Stockpile).amounts;
        for (const slot of slots) shelf.set(slot.goodType, slot.capacity);
        if (withHome) {
          const placed = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, HOME_AT.x, HOME_AT.y);
          home = placed;
          sim.world.mut(placed, components.Stockpile).amounts.clear();
        }
        const bakery = placeBuiltSandboxBuilding(sim, BUILDING_BAKERY, 12, 10);
        sim.world.mut(bakery, components.Stockpile).amounts.set(GOOD_BREAD, BAKERY_SHELF);
        spawnWorkersAtDoor(sim, bakery, 1);
      },
    },
  };
}

/** Sweeps until the bakery has stood the stall grace with its shelf full and nowhere to take bread: the
 *  baker's first loaves go out before its shelf stays full. */
const STALL_FORMED_SWEEPS = 150;

/** The one baker posted at the scene's bakery. */
function bakerOf(sim: Simulation): Entity {
  const baker = [...sim.world.query(components.JobAssignment)].find((e) => {
    const workplace = sim.world.get(e, components.JobAssignment).workplace;
    return sim.world.get(workplace, components.Building)?.buildingType === BUILDING_BAKERY;
  });
  if (baker === undefined) throw new Error('no baker');
  return baker;
}

/** The food a storehouse banks bread as. */
function storedBread(sim: Simulation): number {
  return systems.edibleGoodFormOf(sim.content, GOOD_BREAD);
}

describe('storage-full notes over real runs', () => {
  it('names the food the full headquarters and home hold once the baker cannot bake', () => {
    const sim = createSceneSim(registeredScene('storage-full'));
    sim.run(2);
    const { storageFull, standing } = watchStalls(sim).run(SWEEPS_TO_STORAGE_GRACE + 2);
    expect(storageFull.map((m) => m.goodType)).toEqual([storedBread(sim)]);
    expect(standing).toEqual([]);
  });

  it('stays silent while the baker still carries bread to a home with room', () => {
    const { scene, home } = fullHeadquarters(true);
    const sim = createSceneSim(scene);
    sim.run(2);
    // Long enough for the baker to stand on its full shelf while it fetches inputs, then carry loaves.
    const { storageFull } = watchStalls(sim).run(STALL_FORMED_SWEEPS);
    const homeFood = sim.world.get(home() as Entity, components.Stockpile).amounts.get(storedBread(sim)) ?? 0;
    expect(homeFood).toBeGreaterThan(0);
    expect(storageFull).toEqual([]);
  });

  it('speaks for the bakery once no store takes bread, and retires once the headquarters has room', () => {
    const { scene, headquarters } = fullHeadquarters(false);
    const sim = createSceneSim(scene);
    sim.run(2);
    const watch = watchStalls(sim);
    const blocked = watch.run(STALL_FORMED_SWEEPS);
    expect(blocked.storageFull.map((m) => m.goodType)).toEqual([storedBread(sim)]);
    // The baker stands for want of a store, which the stall note would name; it leaves that to this note.
    expect(sim.workStatus(bakerOf(sim))).toMatchObject({
      kind: 'outputFull',
      outputs: [{ goodType: GOOD_BREAD, destination: 'none' }],
    });
    expect(blocked.raised).toEqual([]);
    expect(blocked.standing).toEqual([]);
    sim.world.mut(headquarters() as Entity, components.Stockpile).amounts.set(storedBread(sim), 0);
    expect(watch.run(1).storageFull).toEqual([]);
  });
});
