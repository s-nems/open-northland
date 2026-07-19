import type { Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  BUILDING_BAKERY,
  BUILDING_FARM,
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  BUILDING_WELL,
  GOOD_BREAD,
  GOOD_FLOUR,
  GOOD_WATER,
  JOB_COLLECTOR,
  placeSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { holdsSometimeDuring } from './runtime.js';
import type { SceneDefinition } from './types.js';

/**
 * The production-chain scene: the original's grain economy end-to-end in one place — farm → mill → bakery,
 * fed by the well. A grain farm field-farms wheat on the grass around it; the mill's millers fetch that
 * wheat and grind it to flour; the well draws water; the bakery's baker fetches flour + water and bakes
 * bread. Every link is the generic producer/haul AI — no chain-specific code — the goods flowing
 * building-to-building because a workshop fetches each input from the nearest store that holds it, so the
 * mill pulls the farm's wheat and the bakery pulls the mill's flour and the well's water without a depot in
 * between (the warehouse is just the bread sink + overflow). The headless half asserts the whole chain
 * closes (fields sown, flour ground, water drawn, bread baked); the browser half is where a human watches
 * the four workshops and the goods ferried between them.
 */

const MAP_W = 46;
const MAP_H = 28;
// The chain laid left→right so each workshop sits beside its input's producer: farm (wheat) → mill (flour)
// → bakery (bread), the well (water) just above the bakery, and a warehouse past the bakery as the bread
// sink + overflow. Gaps leave the farm a grass ring to sow and keep every footprint clear.
const FARM = { x: 10, y: 15 } as const;
const MILL = { x: 19, y: 15 } as const;
const BAKERY = { x: 28, y: 15 } as const;
const WELL = { x: 28, y: 8 } as const;
const WAREHOUSE = { x: 37, y: 15 } as const;

/** Crew per workshop, from the extracted worker slots: farm `logicworker 18 4` (two read clearly), mill
 *  `logicworker 19 2` (both), bakery `logicworker 20 1`; the well's lone `logicworker 24 1` carrier draws
 *  and hauls its water (a carrier-only workplace — see spawnWorkersAtDoor / primaryWorkerJob). */
const FARMERS = 2;
const MILLERS = 2;
const BAKERS = 1;
const WELL_CARRIERS = 1;

/** Long enough for the serial chain to close: the farm's fields ripen (a sowing + one watering per stage,
 *  ~2000 ticks) and feed the mill, then flour and water reach the bakery; 9000 includes margin for the
 *  calibrated 18-tick-per-cell walks between workshops. */
const RUN_TICKS = 9000;

/** Extra ticks the sown-fields check may step a fresh run past {@link RUN_TICKS}: one observed
 *  harvest-trough recovery (~800 ticks in the trace) with headroom. */
const RESOW_WINDOW_TICKS = 1600;
/** Frames the whole cluster; ≠ 1 so `cameraFor` centres on the settlers (a non-1 zoom). */
const INITIAL_ZOOM = 0.7;

const { Crop, Stockpile } = components;

/** The tech enabler's corner — clear of the chain so the lone collector just idles (no resource nodes to
 *  harvest; the farm's wheat is a Crop, not a collector's gatherable). */
const ENABLER = { x: 2, y: 2 } as const;

function build(sim: Simulation): void {
  // The farm/mill/bakery/well are `jobEnablesHouse`-gated on a collector (see tech-graph.ts), so a lone
  // collector must be present or none of the crews below get employed — the gatherer a real game's HQ seeds.
  spawnSandboxSettler(sim, JOB_COLLECTOR, ENABLER.x, ENABLER.y);
  placeSandboxBuilding(sim, BUILDING_FARM, FARM.x, FARM.y);
  placeSandboxBuilding(sim, BUILDING_MILL, MILL.x, MILL.y);
  placeSandboxBuilding(sim, BUILDING_BAKERY, BAKERY.x, BAKERY.y);
  placeSandboxBuilding(sim, BUILDING_WELL, WELL.x, WELL.y);
  placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y);
  // Each crew spawns at its building's door so the adopt pass binds it on tick 1 (see spawnWorkersAtDoor).
  spawnWorkersAtDoor(sim, BUILDING_FARM, FARM.x, FARM.y, FARMERS);
  spawnWorkersAtDoor(sim, BUILDING_MILL, MILL.x, MILL.y, MILLERS);
  spawnWorkersAtDoor(sim, BUILDING_BAKERY, BAKERY.x, BAKERY.y, BAKERS);
  spawnWorkersAtDoor(sim, BUILDING_WELL, WELL.x, WELL.y, WELL_CARRIERS);
}

/** Total units of one good across every stockpile in the world (building stores + loose piles). */
function totalOf(sim: Simulation, goodType: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile)) total += sim.world.get(e, Stockpile).amounts.get(goodType) ?? 0;
  return total;
}

/** Standing wheat fields (Crop entities) the farmers have sown. */
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
      // The run's end tick can land in the harvest trough (every field just cut, the resow under way —
      // observed once the farmers also pause to gossip), so a bare end-tick sample is luck. When it is
      // empty, a fresh run gets a bounded resow window past the scene's own length.
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
      label: 'the bakery baked bread — the whole farm→mill→bakery+well chain closed',
      predicate: (sim) => totalOf(sim, GOOD_BREAD) > 0,
    },
  ],
};
