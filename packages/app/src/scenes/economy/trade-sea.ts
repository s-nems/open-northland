import {
  type CellTerrainMap,
  components,
  type Entity,
  playerCommand,
  type Simulation,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { JOB_TRADER } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';
import { sceneTrader } from './trade.js';

/**
 * A trader's route across the sea. Two islands with a strait between them, an own warehouse on each,
 * wood in the western one and the eastern one marked to import it. The trader ferries the wood to the
 * small ship pinned to its route in several trips of its handcart, sails with the cart aboard and
 * ferries the load ashore. The browser view is the check that the ferry, the voyage and the cart's ride
 * read as one route, and that the selected trader's Trade section shows the ship.
 */

const MAP_W = 26;
const MAP_H = 14;
/** The strait's cells; the west island ends west of it, the east island starts east of it. */
const STRAIT = { fromX: 10, toX: 17 } as const;
const WEST_HOUSE_AT = { x: 6, y: 7 } as const;
const EAST_HOUSE_AT = { x: 20, y: 7 } as const;
const TRADER_AT = { x: 7, y: 11 } as const;
/** The handcart the trader pulls, a cell beside the trader. */
const CART_AT = { x: 8, y: 11 } as const;
/** One cell off the west shore, within its door distance of the land. */
const SHIP_AT = { x: STRAIT.fromX + 1, y: 7 } as const;
/** The handcart's hold, in units. */
const HANDCART_HOLD = 15;
/** Two cart loads, within the small ship's fifty. */
const TRADE_SEA_WOOD = 30;
export const TRADE_SEA_ZOOM = 0.8;
export const TRADE_SEA_EAST_SLOT = 1;

/** Headroom over the measured run: seed 45 lands the last unit by tick 1800. */
const RUN_TICKS = TICKS_PER_SECOND * 160;

const { setStockAmount, Stockpile, WALK_DIRECTION } = components;

export function tradeSeaTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++)
      typeIds[y * MAP_W + x] = x >= STRAIT.fromX && x < STRAIT.toX ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

/** The shared world: `pinned` pins the ship to the route from the first tick. */
export function buildTradeSea(sim: Simulation, pinned: boolean): void {
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
  const wood = goodBySlug(sim, 'wood');
  setStockAmount(sim.world, west, wood, TRADE_SEA_WOOD);
  const trader = spawnSettlerDirect(sim, JOB_TRADER, TRADER_AT.x, TRADER_AT.y, HUMAN_PLAYER);
  const cart = spawnVehicleDirect(sim, VEHICLE_HANDCART, CART_AT.x, CART_AT.y);
  const ship = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, SHIP_AT.x, SHIP_AT.y, {
    facing: WALK_DIRECTION.W,
  });
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: west }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: east }));
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'setTradeImport',
      entity: trader,
      house: east,
      good: wood,
      on: true,
    }),
  );
  if (pinned) sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'setTradeShip', entity: trader, ship }));
}

/** The small ship the scene spawned. */
export function tradeSeaShip(sim: Simulation): Entity | undefined {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_SHIP_SMALL)?.entity;
}

/** The wood in the route's stop at `slot`. */
export function tradeSeaWoodAt(sim: Simulation, slot: number): number {
  const trader = sceneTrader(sim);
  const stop = trader === undefined ? undefined : sim.traderView(trader)?.stops[slot];
  if (stop === undefined) return 0;
  return sim.world.get(stop.house, Stockpile).amounts.get(goodBySlug(sim, 'wood')) ?? 0;
}

export const tradeSeaScene: SceneDefinition = {
  id: 'trade-sea',
  seed: 45,
  terrain: tradeSeaTerrain(),
  build: (sim) => buildTradeSea(sim, true),
  runTicks: RUN_TICKS,
  initialZoom: TRADE_SEA_ZOOM,
  checks: [
    {
      label: 'the wood crossed the sea: more reached the far warehouse than the cart holds in one load',
      predicate: (sim) => tradeSeaWoodAt(sim, TRADE_SEA_EAST_SLOT) > HANDCART_HOLD,
    },
    {
      label: 'the trader kept the ship and the cart it set out with',
      predicate: (sim) => {
        const trader = sceneTrader(sim);
        const view = trader === undefined ? undefined : sim.traderView(trader);
        return view?.ship?.vehicleType === VEHICLE_SHIP_SMALL && view.cart?.vehicleType === VEHICLE_HANDCART;
      },
    },
  ],
};
