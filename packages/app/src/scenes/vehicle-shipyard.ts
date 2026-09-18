import type { Simulation } from '@open-northland/sim';
import { type CellTerrainMap, cellAnchorNode, components } from '@open-northland/sim';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../catalog/terrain.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_JOINERY_03,
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
  VEHICLE_CATAPULT,
  VEHICLE_SHIP_SMALL,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * A level-4 joinery on a shore, its joiners set to the small ship and the catapult in turn: the ship's
 * yard opens on the water beside the shop with its work point on the joiners' shore, the catapult's on
 * the land, and each finished site becomes its vehicle (docs/formats/VEHICLES.md "Construction"). The
 * browser view is the check that the shipwright hammers at the shore while the hull grows on the water
 * and that the launched ship lies moored there with its sails furled.
 */

const MAP_W = 26;
const MAP_H = 20;
/** Cell rows above this are water: the ship yard's door lies south of its hull, so the shore runs along
 *  the north of the shop. */
const SHORE_Y = 8;
const JOINERY = { x: 12, y: 11 } as const;
const DEPOT = { x: 5, y: 14 } as const;
const DEPOT_WOOD = 80;
const DEPOT_LEATHER = 20;
const DEPOT_IRON = 10;
const JOINERS = 3;
/** Headroom over the measured run: seed 19 launches the ship by tick 2260 (the yard's 65k labour over
 *  three joiners) and the catapult by tick 4540. */
const RUN_TICKS = 5_000;

const { CraftSelection, JobAssignment, Settler } = components;

function shoreTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) typeIds[y * MAP_W + x] = y < SHORE_Y ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function build(sim: Simulation): void {
  const depot = cellAnchorNode(DEPOT.x, DEPOT.y);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_WAREHOUSE_00,
    x: depot.hx,
    y: depot.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    force: true,
    initialGoods: [
      { good: goodBySlug(sim, 'wood'), amount: DEPOT_WOOD },
      { good: goodBySlug(sim, 'leather'), amount: DEPOT_LEATHER },
      { good: goodBySlug(sim, 'iron'), amount: DEPOT_IRON },
    ],
  });
  const joinery = placeBuiltSandboxBuilding(sim, BUILDING_JOINERY_03, JOINERY.x, JOINERY.y);
  spawnWorkersAtDoor(sim, joinery, JOINERS);
  const turns = () => [goodBySlug(sim, 'ship_small'), goodBySlug(sim, 'catapult')]; // one list per settler
  for (const e of sim.world.query(Settler, JobAssignment)) {
    if (sim.world.get(e, JobAssignment).workplace !== joinery) continue;
    sim.world.add(e, CraftSelection, { goods: turns(), cursor: 0 });
  }
}


export const vehicleShipyardScene: SceneDefinition = {
  id: 'vehicle-shipyard',
  seed: 19,
  terrain: shoreTerrain(),
  build,
  runTicks: RUN_TICKS,
  progression: false,
  initialZoom: 1.2,
  checks: [
    {
      label: 'the joinery launched a small ship, lying moored on the water',
      predicate: (sim) =>
        sim.vehiclesOf(HUMAN_PLAYER).some((v) => v.vehicleType === VEHICLE_SHIP_SMALL && v.moored),
    },
    {
      label: 'the joinery launched a catapult on the land',
      predicate: (sim) => sim.vehiclesOf(HUMAN_PLAYER).some((v) => v.vehicleType === VEHICLE_CATAPULT),
    },
    {
      label: 'no vehicle was ever shelved as a ware',
      predicate: (sim) => {
        const wares = new Set([goodBySlug(sim, 'ship_small'), goodBySlug(sim, 'catapult')]);
        for (const e of sim.world.query(components.Building, components.Stockpile)) {
          const amounts = sim.world.get(e, components.Stockpile).amounts;
          for (const good of wares) if ((amounts.get(good) ?? 0) > 0) return false;
        }
        return true;
      },
    },
  ],
};
