import { components, playerCommand, type Simulation, TICKS_PER_SECOND } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_TRADER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * Two traders carry wood west to east between own warehouses, one route a row: the upper trader on foot,
 * a unit in its hands a trip, the lower one with the handcart it pulls, stood by each warehouse's door
 * while it loads and unloads. The browser view is the check that the walker carries the wood by hand and
 * the cart is pulled, set down and taken up again.
 */

const MAP_W = 24;
const MAP_H = 14;

const ROUTES = [
  { fromX: 4, toX: 18, y: 4, cart: false },
  { fromX: 4, toX: 18, y: 10, cart: true },
] as const;
/** Where each trader starts, below its route's first warehouse; the cart stands a cell east of it. */
const TRADER_OFFSET = { x: 1, y: 2 } as const;
const WOOD_STOCKED = 30;

/** Long enough for the walker's few trips and the cart's full load over. */
const RUN_TICKS = TICKS_PER_SECOND * 490;

const { setStockAmount, Stockpile } = components;

function build(sim: Simulation): void {
  const wood = goodBySlug(sim, 'wood');
  for (const route of ROUTES) {
    const from = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, route.fromX, route.y, HUMAN_PLAYER);
    const to = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, route.toX, route.y, HUMAN_PLAYER);
    setStockAmount(sim.world, from, wood, WOOD_STOCKED);
    const x = route.fromX + TRADER_OFFSET.x;
    const y = route.y + TRADER_OFFSET.y;
    const trader = spawnSettlerDirect(sim, JOB_TRADER, x, y, HUMAN_PLAYER);
    if (route.cart) {
      const cart = spawnVehicleDirect(sim, VEHICLE_HANDCART, x + 1, y);
      sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
    }
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: from }));
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: to }));
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, {
        kind: 'setTradeImport',
        entity: trader,
        house: to,
        good: wood,
        on: true,
      }),
    );
  }
}

/** The wood the trader with or without a cart has brought to its route's second warehouse, or -1 when no
 *  such trader holds a full route. */
function woodDelivered(sim: Simulation, withCart: boolean): number {
  for (const e of sim.world.query(components.TradeRoute)) {
    const view = sim.traderView(e);
    const to = view?.stops[1]?.house;
    if (view === undefined || to === undefined || (view.cart !== null) !== withCart) continue;
    return sim.world.get(to, Stockpile).amounts.get(goodBySlug(sim, 'wood')) ?? 0;
  }
  return -1;
}

export const tradeOnFootScene: SceneDefinition = {
  id: 'trade-on-foot',
  seed: 45,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.6,
  checks: [
    {
      label: 'the trader on foot carried wood over by hand',
      predicate: (sim) => woodDelivered(sim, false) > 0,
    },
    {
      label: 'the trader pulling the handcart brought its whole load over, more than the walker',
      predicate: (sim) =>
        woodDelivered(sim, true) === WOOD_STOCKED && woodDelivered(sim, false) < WOOD_STOCKED,
    },
  ],
};
