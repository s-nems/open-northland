import {
  components,
  type Entity,
  type HalfCellNode,
  nodeOfPosition,
  playerCommand,
  type Simulation,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { JOB_TRADER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';
import { sceneTrader } from './trade.js';
import { EAST_HOUSE_AT, TRADE_SEA_ZOOM, tradeSeaTerrain, WEST_SHIP_X } from './trade-sea.js';

/**
 * Two sea routes sharing a stop: each trader has its own warehouse on the west island and a small ship
 * pinned to its route, and both carry wood to the one warehouse on the east island. The ship that reaches
 * the east shore second moors beside the first instead of waiting for it to leave. The browser view is
 * the check that both hulls lie at the east shore together while both carts ferry.
 */

/** Each route's west warehouse, its trader and cart beside it, and its ship off the shore level with it. */
const ROUTES = [
  { houseAt: { x: 6, y: 3 }, traderAt: { x: 7, y: 5 }, shipY: 3 },
  { houseAt: { x: 6, y: 10 }, traderAt: { x: 7, y: 12 }, shipY: 10 },
] as const;
/** Two cart loads per route, within the small ship's fifty. */
const ROUTE_WOOD = 30;
/** Headroom over the run: seed 45 lands the last unit near tick 2110, which a sim change moves. */
const RUN_TICKS = TICKS_PER_SECOND * 200;

const { Position, setStockAmount, Stockpile, Vehicle, WALK_DIRECTION } = components;

export function buildTradeSeaSharedStop(sim: Simulation): void {
  const order = (command: Parameters<typeof playerCommand>[1]): void => {
    sim.enqueue(playerCommand(HUMAN_PLAYER, command));
  };
  const east = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    EAST_HOUSE_AT.x,
    EAST_HOUSE_AT.y,
    HUMAN_PLAYER,
  );
  for (const { houseAt, traderAt, shipY } of ROUTES) {
    const west = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, houseAt.x, houseAt.y, HUMAN_PLAYER);
    setStockAmount(sim.world, west, GOOD_WOOD, ROUTE_WOOD);
    const trader = spawnSettlerDirect(sim, JOB_TRADER, traderAt.x, traderAt.y, HUMAN_PLAYER);
    const cart = spawnVehicleDirect(sim, VEHICLE_HANDCART, traderAt.x + 1, traderAt.y);
    const ship = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, WEST_SHIP_X, shipY, {
      facing: WALK_DIRECTION.W,
    });
    order({ kind: 'attachToVehicle', entity: trader, vehicle: cart });
    order({ kind: 'attachTradeHouse', entity: trader, house: west });
    order({ kind: 'attachTradeHouse', entity: trader, house: east });
    order({ kind: 'setTradeImport', entity: trader, house: east, good: GOOD_WOOD, on: true });
    order({ kind: 'setTradeShip', entity: trader, ship });
  }
}

/** The shared east warehouse, a trader's second stop. */
function sharedStop(sim: Simulation): Entity | undefined {
  const trader = sceneTrader(sim);
  return trader === undefined ? undefined : sim.traderView(trader)?.stops[1]?.house;
}

/** Whether `at` lies on the shared warehouse's island. */
function onSharedIsland(sim: Simulation, at: HalfCellNode): boolean {
  const house = sharedStop(sim);
  const terrain = sim.terrain;
  if (house === undefined || terrain === undefined) return false;
  const { x, y } = sim.world.get(house, Position);
  const door = nodeOfPosition(x, y);
  const landOf = (node: HalfCellNode): number => terrain.componentOf(terrain.nodeAt(node.hx, node.hy));
  return landOf(at) === landOf(door);
}

export const tradeSeaSharedStopScene: SceneDefinition = {
  id: 'trade-sea-shared-stop',
  seed: 45,
  terrain: tradeSeaTerrain(),
  build: buildTradeSeaSharedStop,
  runTicks: RUN_TICKS,
  initialZoom: TRADE_SEA_ZOOM,
  checks: [
    {
      label: "both routes' wood reached the warehouse they share",
      predicate: (sim) => {
        const house = sharedStop(sim);
        const wood = house === undefined ? 0 : sim.world.get(house, Stockpile).amounts.get(GOOD_WOOD);
        return wood === ROUTE_WOOD * ROUTES.length;
      },
    },
    {
      label: 'both ships lie moored at the east shore together',
      predicate: (sim) => {
        const ships = sim.vehiclesOf(HUMAN_PLAYER).filter((v) => v.vehicleType === VEHICLE_SHIP_SMALL);
        return (
          ships.length === ROUTES.length &&
          ships.every(({ entity }) => {
            const { moored, mooring } = sim.world.get(entity, Vehicle);
            return moored && mooring !== null && onSharedIsland(sim, mooring);
          })
        );
      },
    },
  ],
};
