import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  BUILDING_WELL,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * A well of every civilization, west to east: viking, frank, byzantine, saracen, egyptian. Each well's
 * carrier pumps water and carries it to the warehouse below it, so the pump plays at every nation's well.
 */

const CIVILIZATIONS = [1, 2, 3, 4, 7] as const;
/** Far enough apart that no tall warehouse stands in front of a well or of its neighbour. */
const COLUMN_STEP = 6;
const FIRST_COLUMN_X = 4;
const WELL_Y = 4;
const WAREHOUSE_Y = 13;
const MAP_W = FIRST_COLUMN_X * 2 + (CIVILIZATIONS.length - 1) * COLUMN_STEP;
const MAP_H = 17;
const RUN_TICKS = 1500;

const { Building, Stockpile } = components;

function build(sim: Simulation): void {
  for (const [column, tribe] of CIVILIZATIONS.entries()) {
    const x = FIRST_COLUMN_X + column * COLUMN_STEP;
    const well = placeBuiltSandboxBuilding(sim, BUILDING_WELL, x, WELL_Y, HUMAN_PLAYER, { tribe });
    placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, x, WAREHOUSE_Y, HUMAN_PLAYER, { tribe });
    spawnWorkersAtDoor(sim, well, 1, { tribe });
  }
}

/** The water in each civilization's warehouse, west to east. */
function warehouseWater(sim: Simulation): number[] {
  const water = goodBySlug(sim, 'water');
  const byTribe = new Map<number, number>();
  for (const e of sim.world.query(Building, Stockpile)) {
    const building = sim.world.get(e, Building);
    if (building.buildingType !== BUILDING_WAREHOUSE_00) continue;
    byTribe.set(building.tribe, sim.world.get(e, Stockpile).amounts.get(water) ?? 0);
  }
  return CIVILIZATIONS.map((tribe) => byTribe.get(tribe) ?? 0);
}

export const wellDrawersScene: SceneDefinition = {
  id: 'well-drawers',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  graphicTribes: CIVILIZATIONS,
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.7,
  needs: false,
  progression: false,
  checks: [
    {
      label: 'every civilization pumped water at its well into its warehouse',
      predicate: (sim) => warehouseWater(sim).every((amount) => amount > 0),
    },
  ],
};
