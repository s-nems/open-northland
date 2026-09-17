import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_JOINERY_02,
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
  VEHICLE_HANDCART,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * A level-3 joinery whose joiners are set to make handcarts: each opens a hidden yard site beside the shop,
 * carries the wood in from the warehouse, hammers on it, and the finished site becomes a cart standing
 * where the yard stood (docs/formats/VEHICLES.md "Construction"). The browser view is the check that
 * the yard draws as the cart house's construction and the cart takes its place.
 */

const MAP_W = 24;
const MAP_H = 18;
const JOINERY = { x: 12, y: 9 } as const;
const DEPOT = { x: 5, y: 9 } as const;
const DEPOT_WOOD = 60;
const JOINERS = 2;
/** Headroom over the measured first cart: seed 13 launches it by tick 700. */
const RUN_TICKS = 1_500;

const { Building, CraftSelection, JobAssignment, Settler, Stockpile, UnderConstruction, Vehicle } =
  components;

/** The cart good and its yard, by slug: the sandbox keeps the good at +100 while real content keeps
 *  `goodtypes.ini` 59, and the yard house is 42 in both. */
function handcartGood(sim: Simulation): number {
  return goodBySlug(sim, 'handcart');
}
function handcartYard(sim: Simulation): number {
  const yard = sim.content.goods.find((g) => g.id === 'handcart')?.vehicleHouse;
  if (yard === undefined) throw new Error('scene content pairs no yard with the handcart');
  return yard;
}

function build(sim: Simulation): void {
  const wood = goodBySlug(sim, 'wood');
  const depot = cellAnchorNode(DEPOT.x, DEPOT.y);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_WAREHOUSE_00,
    x: depot.hx,
    y: depot.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    force: true,
    initialGoods: [{ good: wood, amount: DEPOT_WOOD }],
  });
  const joinery = placeBuiltSandboxBuilding(sim, BUILDING_JOINERY_02, JOINERY.x, JOINERY.y);
  spawnWorkersAtDoor(sim, joinery, JOINERS);
  for (const e of sim.world.query(Settler, JobAssignment)) {
    if (sim.world.get(e, JobAssignment).workplace !== joinery) continue;
    sim.world.add(e, CraftSelection, { goods: [handcartGood(sim)], cursor: 0 });
  }
}

function yardSites(sim: Simulation): number {
  const yard = handcartYard(sim);
  let n = 0;
  for (const e of sim.world.query(Building, UnderConstruction)) {
    if (sim.world.get(e, Building).buildingType === yard) n++;
  }
  return n;
}

function handcarts(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Vehicle)) {
    if (sim.world.get(e, Vehicle).vehicleType === VEHICLE_HANDCART) n++;
  }
  return n;
}

export const vehicleYardScene: SceneDefinition = {
  id: 'vehicle-yard',
  seed: 13,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  progression: false,
  initialZoom: 1.2,
  checks: [
    {
      label: 'the joinery turned out at least one handcart for the player',
      predicate: (sim) => sim.vehiclesOf(HUMAN_PLAYER).some((v) => v.vehicleType === VEHICLE_HANDCART),
    },
    {
      label: 'the joiners keep building: a yard site stands or a cart was just launched',
      predicate: (sim) => yardSites(sim) > 0 || handcarts(sim) > 0,
    },
    {
      label: 'no handcart was ever shelved as a ware',
      predicate: (sim) => {
        const cart = handcartGood(sim);
        for (const e of sim.world.query(Building, Stockpile)) {
          if ((sim.world.get(e, Stockpile).amounts.get(cart) ?? 0) > 0) return false;
        }
        return true;
      },
    },
  ],
};
