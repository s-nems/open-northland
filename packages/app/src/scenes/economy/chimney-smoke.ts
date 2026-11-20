import { components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import {
  BUILDING_BAKERY,
  BUILDING_POTTERY_01,
  BUILDING_SMITHY,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const MAP_W = 24;
const MAP_H = 18;
const WORKING_BAKERY = { x: 4, y: 6 } as const;
const SMITHY = { x: 10, y: 6 } as const;
const POTTERY = { x: 16, y: 6 } as const;
/** A manned bakery with nothing to bake: its chimney stays cold beside the working one's. */
const IDLE_BAKERY = { x: 10, y: 13 } as const;
/** Long enough for each worker to walk in and finish a first product. */
const RUN_TICKS = 400;
const INITIAL_ZOOM = 0.9;

const { Building, Stockpile } = components;

/** A finished, manned `buildingType` with full input shelves and room for what it makes, or with bare
 *  shelves when not `stocked`. */
function workshop(
  sim: Simulation,
  buildingType: number,
  at: { x: number; y: number },
  stocked = true,
): Entity {
  const building = placeBuiltSandboxBuilding(sim, buildingType, at.x, at.y);
  const amounts = sim.world.mut(building, Stockpile).amounts;
  amounts.clear();
  const definition = sim.content.buildings.find((row) => row.typeId === buildingType);
  for (const slot of definition?.stock ?? []) {
    if (stocked && slot.input) amounts.set(slot.goodType, slot.capacity);
  }
  spawnWorkersAtDoor(sim, building, 1);
  return building;
}

/** How many workshops of `buildingType` hold something they made. */
function productive(sim: Simulation, buildingType: number): number {
  const outputs = sim.content.buildings
    .find((row) => row.typeId === buildingType)
    ?.stock.filter((slot) => !slot.input);
  let count = 0;
  for (const building of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(building, Building).buildingType !== buildingType) continue;
    const amounts = sim.world.get(building, Stockpile).amounts;
    if (outputs?.some((slot) => (amounts.get(slot.goodType) ?? 0) > 0) === true) count++;
  }
  return count;
}

export const chimneySmokeScene: SceneDefinition = {
  id: 'chimney-smoke',
  seed: 97,
  terrain: grassTerrain(MAP_W, MAP_H),
  initialZoom: INITIAL_ZOOM,
  progression: false,
  build: (sim) => {
    workshop(sim, BUILDING_BAKERY, WORKING_BAKERY);
    workshop(sim, BUILDING_SMITHY, SMITHY);
    workshop(sim, BUILDING_POTTERY_01, POTTERY);
    workshop(sim, BUILDING_BAKERY, IDLE_BAKERY, false);
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      // The smithy is here for the browser: the fallback catalog gives it no recipe.
      label: 'the stocked bakery and the pottery made something, the bare bakery nothing',
      predicate: (sim) =>
        productive(sim, BUILDING_BAKERY) === 1 && productive(sim, BUILDING_POTTERY_01) === 1,
    },
  ],
};
