import {
  cellAnchorNode,
  components,
  type Entity,
  playerCommand,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CARRIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  dropSandboxGood,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * Two carts and their carriers (docs/formats/VEHICLES.md "Cargo"): a handcart whose player asks for wood,
 * which its carrier fetches unit by unit from the piles beside the door, and an ox cart that starts loaded
 * with stone nobody asked for, which its carrier flushes into the warehouse. The browser view is the
 * check that the handcart switches to its loaded body once the first unit is aboard and the ox cart back
 * to its empty one once the last unit leaves.
 */

const MAP_W = 24;
const MAP_H = 16;
const HANDCART = { x: 6, y: 5 } as const;
const OXCART = { x: 6, y: 11 } as const;
const DEPOT = { x: 11, y: 11 } as const;
/** The wood piles lie a few cells east of the handcart's door, well within the carrier's door radius. */
const WOOD_PILES: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 9, y: 4 },
  { x: 10, y: 5 },
  { x: 9, y: 6 },
];
const PILE_UNITS = 5;
const WANTED_WOOD = 6;
const LOADED_STONE = 4;
/** The carriers stand one cell behind their carts. */
const CARRIER_OFFSET_X = -1;
/** Headroom over the measured run: seed 17 fills the handcart by tick 900 and empties the ox cart, its
 *  last unit shelved, by 1000. */
const RUN_TICKS = 1_300;

const { Building, Stockpile } = components;

/** A cart at `at` with a carrier spawned one cell behind it and attached as its crew. */
function crewedCart(sim: Simulation, type: number, at: { readonly x: number; readonly y: number }): Entity {
  const cart = spawnVehicleDirect(sim, type, at.x, at.y);
  const carrier = spawnSettlerDirect(sim, JOB_CARRIER, at.x + CARRIER_OFFSET_X, at.y, HUMAN_PLAYER);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: carrier, vehicle: cart }));
  return cart;
}

function build(sim: Simulation): void {
  const wood = goodBySlug(sim, 'wood');
  const stone = goodBySlug(sim, 'stone');
  const depot = cellAnchorNode(DEPOT.x, DEPOT.y);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_WAREHOUSE_00,
    x: depot.hx,
    y: depot.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    force: true,
  });
  for (const pile of WOOD_PILES) dropSandboxGood(sim, wood, pile.x, pile.y, PILE_UNITS);
  const handcart = crewedCart(sim, VEHICLE_HANDCART, HANDCART);
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'setVehicleWanted',
      vehicle: handcart,
      goodType: wood,
      amount: WANTED_WOOD,
    }),
  );
  const oxcart = crewedCart(sim, VEHICLE_OXCART, OXCART);
  systems.stockVehicleGoods(sim.world, oxcart, sim.content, stone, LOADED_STONE);
}

function cartOfType(sim: Simulation, type: number): ReturnType<Simulation['vehiclesOf']>[number] | undefined {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === type);
}

function depotAmount(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile, Building)) {
    total += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return total;
}

export const vehicleCargoScene: SceneDefinition = {
  id: 'vehicle-cargo',
  seed: 17,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  progression: false,
  initialZoom: 1.2,
  checks: [
    {
      label: 'the handcart holds the wood its player asked for, booked unit by unit',
      predicate: (sim) => {
        const wood = goodBySlug(sim, 'wood');
        const cart = cartOfType(sim, VEHICLE_HANDCART);
        const line = cart?.stock.find((l) => l.good === wood);
        return line !== undefined && line.current === WANTED_WOOD && line.reserved === WANTED_WOOD;
      },
    },
    {
      label: 'the ox cart was emptied into the warehouse',
      predicate: (sim) =>
        cartOfType(sim, VEHICLE_OXCART)?.load === 0 &&
        depotAmount(sim, goodBySlug(sim, 'stone')) === LOADED_STONE,
    },
    {
      label: 'both carriers still crew their carts',
      predicate: (sim) => sim.vehiclesOf(HUMAN_PLAYER).every((v) => v.passengers.length === 1),
    },
  ],
};
