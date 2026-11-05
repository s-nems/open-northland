import {
  components,
  type Entity,
  playerCommand,
  type Simulation,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { JOB_CARRIER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  VEHICLE_SHIP_SMALL,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';
import { sceneTrader } from './trade.js';
import {
  EAST_HOUSE_AT,
  spawnTradeSeaCrew,
  TRADE_SEA_ZOOM,
  tradeSeaShip,
  tradeSeaTerrain,
  WEST_HOUSE_AT,
} from './trade-sea.js';

/**
 * Carriers helping a trader by hand on its sea route: the `trade-sea` crossing with more wood, and three
 * carriers assigned to the pinned ship. They carry a unit a trip between the warehouse and the ship's door
 * on both shores beside the trader's cart, and ride along between. The browser view is the check that they
 * read as the ship's crew, the captain's well staying the trader's.
 */

const WOOD_STOCKED = 60;
/** The carriers assigned to the ship, the first standing at {@link CARRIERS_AT}. */
const HELPERS = 3;
const CARRIERS_AT = { x: 4, y: 11 } as const;
const RUN_SECONDS = 185;

/** Short of the last unit, so the check compares two runs still under way. */
const RUN_TICKS = TICKS_PER_SECOND * RUN_SECONDS;
/** A floor the same world with no carriers must not beat in those ticks, measured at this seed. */
export const TRADER_ALONE_WOOD = 15;

const { setStockAmount, Settler, Stockpile, Vehicle, vehicleCommander, vehiclePassengers } = components;

export function buildTradeSeaCarriers(sim: Simulation, helpers: number): void {
  const west = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    WEST_HOUSE_AT.x,
    WEST_HOUSE_AT.y,
    HUMAN_PLAYER,
  );
  const east = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    EAST_HOUSE_AT.x,
    EAST_HOUSE_AT.y,
    HUMAN_PLAYER,
  );
  setStockAmount(sim.world, west, GOOD_WOOD, WOOD_STOCKED);
  const { trader, ship } = spawnTradeSeaCrew(sim, VEHICLE_SHIP_SMALL);
  const order = (command: Parameters<typeof playerCommand>[1]): void => {
    sim.enqueue(playerCommand(HUMAN_PLAYER, command));
  };
  order({ kind: 'attachTradeHouse', entity: trader, house: west });
  order({ kind: 'attachTradeHouse', entity: trader, house: east });
  order({ kind: 'setTradeImport', entity: trader, house: east, good: GOOD_WOOD, on: true });
  order({ kind: 'setTradeShip', entity: trader, ship });
  for (let slot = 0; slot < helpers; slot++) {
    const carrier = spawnSettlerDirect(sim, JOB_CARRIER, CARRIERS_AT.x + slot, CARRIERS_AT.y, HUMAN_PLAYER);
    order({ kind: 'attachToVehicle', entity: carrier, vehicle: ship });
  }
}

/** The wood in the far warehouse. */
export function farWood(sim: Simulation): number {
  const trader = sceneTrader(sim);
  const stop = trader === undefined ? undefined : sim.traderView(trader)?.stops[1];
  return stop === undefined ? 0 : (sim.world.get(stop.house, Stockpile).amounts.get(GOOD_WOOD) ?? 0);
}

/** The carriers seated on the scene's ship. */
function shipHelpers(sim: Simulation, ship: Entity): Entity[] {
  return vehiclePassengers(sim.world.get(ship, Vehicle))
    .map((seat) => seat.entity)
    .filter((rider) => sim.world.get(rider, Settler).jobType === JOB_CARRIER);
}

export const tradeSeaCarriersScene: SceneDefinition = {
  id: 'trade-sea-carriers',
  seed: 45,
  terrain: tradeSeaTerrain(),
  build: (sim) => buildTradeSeaCarriers(sim, HELPERS),
  runTicks: RUN_TICKS,
  initialZoom: TRADE_SEA_ZOOM,
  checks: [
    {
      label: 'more wood reached the far warehouse than the trader alone moves in the same ticks',
      predicate: (sim) => farWood(sim) > TRADER_ALONE_WOOD,
    },
    {
      label: 'every carrier kept its seat',
      predicate: (sim) => {
        const ship = tradeSeaShip(sim);
        return ship !== undefined && shipHelpers(sim, ship).length === HELPERS;
      },
    },
    {
      label: "the captain's seat stayed the trader's",
      predicate: (sim) => {
        const ship = tradeSeaShip(sim);
        const state = ship === undefined ? undefined : sim.world.get(ship, Vehicle);
        if (state === undefined || state.hauler !== sceneTrader(sim)) return false;
        const commander = vehicleCommander(state);
        return commander === null || commander === state.hauler;
      },
    },
  ],
};
