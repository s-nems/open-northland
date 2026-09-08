import type { Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR } from '../catalog/jobs.js';
import {
  BUILDING_BAKERY,
  BUILDING_FARM,
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  BUILDING_WELL,
  GOOD_BREAD,
  GOOD_FLOUR,
  GOOD_WATER,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { holdsSometimeDuring } from './runtime.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 46;
const MAP_H = 28;
// Laid left to right so each workshop sits beside its input's producer, with gaps that leave the farm a
// grass ring to sow and keep every footprint clear.
const FARM = { x: 10, y: 15 } as const;
const MILL = { x: 19, y: 15 } as const;
const BAKERY = { x: 28, y: 15 } as const;
const WELL = { x: 28, y: 8 } as const;
const WAREHOUSE = { x: 37, y: 15 } as const;

/** Crew from the extracted `logicworker` slots; the farm's row lists four but only two read clearly. */
const FARMERS = 2;
const MILLERS = 2;
const BAKERS = 1;
const WELL_CARRIERS = 1;

/** Covers the serial cold start (the first bread lands near tick 2600) plus margin for the 18-tick-per-cell
 *  walks between workshops. */
const RUN_TICKS = 6000;

/** Slack the sown-fields check may step past `RUN_TICKS`: a reaped node stands empty until its resow. */
const RESOW_WINDOW_TICKS = 600;
/** Not 1, so `cameraFor` centres on the settlers. */
const INITIAL_ZOOM = 0.7;

const { Crop, Stockpile } = components;

/** Clear of the chain and of any gatherable, so the enabling collector just idles. */
const ENABLER = { x: 2, y: 2 } as const;

function build(sim: Simulation): void {
  // The workshops are `jobEnablesHouse`-gated on a collector, so the scene keeps one standing.
  spawnSandboxSettler(sim, JOB_COLLECTOR, ENABLER.x, ENABLER.y);
  const farm = placeBuiltSandboxBuilding(sim, BUILDING_FARM, FARM.x, FARM.y);
  const mill = placeBuiltSandboxBuilding(sim, BUILDING_MILL, MILL.x, MILL.y);
  const bakery = placeBuiltSandboxBuilding(sim, BUILDING_BAKERY, BAKERY.x, BAKERY.y);
  const well = placeBuiltSandboxBuilding(sim, BUILDING_WELL, WELL.x, WELL.y);
  placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y);
  spawnWorkersAtDoor(sim, farm, FARMERS);
  spawnWorkersAtDoor(sim, mill, MILLERS);
  spawnWorkersAtDoor(sim, bakery, BAKERS);
  spawnWorkersAtDoor(sim, well, WELL_CARRIERS);
}

/** Counts building stores and loose piles alike. */
function totalOf(sim: Simulation, goodType: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile)) total += sim.world.get(e, Stockpile).amounts.get(goodType) ?? 0;
  return total;
}

function cropFields(sim: Simulation): number {
  let fields = 0;
  for (const _e of sim.world.query(Crop)) fields++;
  return fields;
}

export const chainScene: SceneDefinition = {
  id: 'chain',
  seed: 15,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the farm field-farms wheat (fields sown on the grass)',
      // A bare end-tick sample is luck: a reap empties its node until the resow, so the count dips.
      predicate: (sim) =>
        cropFields(sim) > 0 ||
        holdsSometimeDuring(chainScene, RUN_TICKS + RESOW_WINDOW_TICKS, (s) => cropFields(s) > 0),
    },
    {
      label: 'the mill ground flour from the harvested wheat',
      predicate: (sim) => totalOf(sim, GOOD_FLOUR) > 0,
    },
    {
      label: 'the well drew water',
      predicate: (sim) => totalOf(sim, GOOD_WATER) > 0,
    },
    {
      label: 'the bakery baked bread - the whole farm→mill→bakery+well chain closed',
      predicate: (sim) => totalOf(sim, GOOD_BREAD) > 0,
    },
  ],
};
