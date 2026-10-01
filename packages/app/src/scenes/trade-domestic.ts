import {
  components,
  type Entity,
  playerCommand,
  type Simulation,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_TRADER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
} from '../game/sandbox/index.js';
import { sceneTrader } from './trade.js';
import type { SceneDefinition } from './types.js';

/**
 * A trader between two of the player's own warehouses, no good marked yet: the browser view is the
 * settler panel's Trade section, where the player picks each good's direction and limits. Nothing moves
 * until a good is marked.
 */

const MAP_W = 24;
const MAP_H = 12;

export const TRADE_DOMESTIC_A_AT = { x: 5, y: 5 } as const;
export const TRADE_DOMESTIC_B_AT = { x: 17, y: 5 } as const;
const TRADER_AT = { x: 6, y: 8 } as const;
/** The handcart the trader commands, a cell beside the trader. */
const CART_AT = { x: 7, y: 8 } as const;

/** The two stocks by good id, different enough that stocked and empty chips show side by side. Keyed
 *  by the string id: the weapons' typeIds differ between the sandbox and the decoded content. */
export const TRADE_DOMESTIC_STOCK_A: ReadonlyMap<string, number> = new Map([
  ['sword_long', 12],
  ['spear_wooden', 7],
  ['food_simple', 20],
]);
export const TRADE_DOMESTIC_STOCK_B: ReadonlyMap<string, number> = new Map([['armor_chain', 5]]);

/** Several round trips of the cart between the two warehouses. */
const RUN_TICKS = TICKS_PER_SECOND * 120;

const { setStockAmount, Stockpile } = components;

function build(sim: Simulation): void {
  const a = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    TRADE_DOMESTIC_A_AT.x,
    TRADE_DOMESTIC_A_AT.y,
    HUMAN_PLAYER,
  );
  const b = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    TRADE_DOMESTIC_B_AT.x,
    TRADE_DOMESTIC_B_AT.y,
    HUMAN_PLAYER,
  );
  for (const [house, stock] of [
    [a, TRADE_DOMESTIC_STOCK_A],
    [b, TRADE_DOMESTIC_STOCK_B],
  ] as const) {
    for (const [id, amount] of stock) {
      const good = tradeDomesticGood(sim, id);
      if (good !== undefined) setStockAmount(sim.world, house, good, amount);
    }
  }
  const trader = spawnSettlerDirect(sim, JOB_TRADER, TRADER_AT.x, TRADER_AT.y, HUMAN_PLAYER);
  const cart = spawnVehicleDirect(sim, VEHICLE_HANDCART, CART_AT.x, CART_AT.y);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: a }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: b }));
}

/** The typeId of a good by its string id in the content the scene runs on. */
export function tradeDomesticGood(sim: Simulation, id: string): number | undefined {
  return sim.content.goods.find((good) => good.id === id)?.typeId;
}

/** The route's two warehouses by slot, A first; undefined before the trader holds both. */
export function tradeDomesticHouses(sim: Simulation): { a: Entity; b: Entity } | undefined {
  const trader = sceneTrader(sim);
  const [a, b] = trader === undefined ? [] : (sim.traderView(trader)?.stops ?? []);
  return a === undefined || b === undefined ? undefined : { a: a.house, b: b.house };
}

export function tradeDomesticStock(sim: Simulation, house: Entity, good: number): number {
  return sim.world.get(house, Stockpile).amounts.get(good) ?? 0;
}

/** Whether a house holds exactly the stock the scene gave it. */
function holdsStartStock(sim: Simulation, house: Entity, stock: ReadonlyMap<string, number>): boolean {
  const held = [...sim.world.get(house, Stockpile).amounts].filter(([, amount]) => amount > 0);
  return (
    held.length === stock.size &&
    [...stock].every(([id, amount]) => {
      const good = tradeDomesticGood(sim, id);
      return good !== undefined && tradeDomesticStock(sim, house, good) === amount;
    })
  );
}

export const tradeDomesticScene: SceneDefinition = {
  id: 'trade-domestic',
  seed: 44,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the trader rides the handcart between two own warehouses with no good marked',
      predicate: (sim) => {
        const trader = sceneTrader(sim);
        const view = trader === undefined ? undefined : sim.traderView(trader);
        return (
          view?.stops.length === 2 &&
          view.stops.every((stop) => !stop.foreign && stop.imports.length === 0) &&
          view.cart?.vehicleType === VEHICLE_HANDCART
        );
      },
    },
    {
      label: 'with no mark nothing moves: both warehouses keep the stock they started with',
      predicate: (sim) => {
        const houses = tradeDomesticHouses(sim);
        return (
          houses !== undefined &&
          holdsStartStock(sim, houses.a, TRADE_DOMESTIC_STOCK_A) &&
          holdsStartStock(sim, houses.b, TRADE_DOMESTIC_STOCK_B)
        );
      },
    },
  ],
};
