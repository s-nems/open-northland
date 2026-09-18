import type { VehicleType } from '@open-northland/data';
import {
  Carrying,
  ownerOf,
  recordGoodsTraded,
  TradeRoute,
  Vehicle,
  type VehicleStateView,
  VehicleStock,
  vehicleLoad,
  vehicleStockEntries,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext, SystemContext } from '../context.js';
import { stockOf } from '../missions/stock.js';
import { grantTradeExperience } from '../progression/index.js';
import { edibleGoodFormOf } from '../readviews/food.js';
import { isShipVehicle, isSiegeVehicle } from '../readviews/vehicles.js';
import { addCarry, dropCarryAtOwnTile } from '../settlers/atomics/effects/goods/carry.js';
import { accessibleStockAmounts, bankedSlot, setAccessibleStockAmount } from '../stores/index.js';
import { commandedVehicleOf } from '../vehicles/commander.js';
import { tradeVehicleStock, vehicleLineCap, vehicleStockGood } from '../vehicles/stock.js';
import { activeAgreement } from './agreements.js';
import { sameFoodClass } from './goods.js';

// The trader's cart: the vehicle it commands, whose `VehicleStock` is the one hold the trade runs on
// (docs/formats/VEHICLES.md "Cargo"; the trader's own write is `tradeVehicleStock`).

/** The cart a trader commands. */
export interface TradeCart {
  readonly vehicle: Entity;
  readonly type: VehicleType;
  readonly state: VehicleStateView;
}

/** A cart's hold as the trade decisions read it: the goods aboard, ascending by good, and the room left. */
export interface CartHold {
  /** `[good, units]` for every good aboard with at least one unit. */
  readonly entries: ReadonlyArray<readonly [number, number]>;
  readonly load: number;
  readonly room: number;
  amount(good: number): number;
  /** Whether the hold takes `good` at all (`logicgood`, dishes through their edible form). */
  carries(good: number): boolean;
}

/**
 * The cart `trader` commands and stands on the map: the vehicle its `Rider` names when it holds the
 * commander seat and the type has a hold and drives the land. Null for a trader on foot, one that only
 * rides along, a ship or a catapult, or a cart riding inside a ship.
 */
export function tradeCartOf(world: World, ctx: ContentContext, trader: Entity): TradeCart | null {
  const vehicle = commandedVehicleOf(world, trader);
  if (vehicle === null) return null;
  const state = world.get(vehicle, Vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || isShipVehicle(type) || isSiegeVehicle(type)) return null;
  if (!world.has(vehicle, VehicleStock)) return null;
  return { vehicle, type, state };
}

/** A detached read of the cart's hold for one decision. */
export function cartHoldOf(world: World, ctx: ContentContext, cart: TradeCart): CartHold {
  const stock = world.get(cart.vehicle, VehicleStock);
  const entries = vehicleStockEntries(stock).flatMap(
    ([good, line]): Array<readonly [number, number]> => (line.current > 0 ? [[good, line.current]] : []),
  );
  const load = vehicleLoad(stock);
  return {
    entries,
    load,
    room: Math.max(0, vehicleLineCap(cart.type) - load),
    amount: (good) => stock.lines.get(good)?.current ?? 0,
    carries: (good) => vehicleStockGood(ctx.content, cart.type, good) !== null,
  };
}

/** Whether the trader is at the stop of another player's house, where the exchange is counted. */
function atForeignStop(world: World, trader: Entity, house: Entity): boolean {
  const route = world.tryGet(trader, TradeRoute);
  return route?.stops.some((stop) => stop.house === house && stop.foreign) === true;
}

/**
 * Resolve one completed `cartLoad`: one unit of `goodType` leaves `from`'s shelf for the hold of the
 * trader's cart, in the form it takes outside the house (a dish becomes its edible). At a foreign stop
 * the unit counts toward the agreement's take and the player's trade tally with the house's owner. A
 * cart with no room, a good the hold refuses, a shelf already empty or no cart at all moves nothing.
 */
export function loadCart(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  from: Entity,
  goodType: number,
): void {
  const route = world.tryGet(trader, TradeRoute);
  const cart = tradeCartOf(world, ctx, trader);
  if (route === undefined || cart === null) return;
  const stock = accessibleStockAmounts(world, from);
  const have = stock?.get(goodType) ?? 0;
  if (stock === undefined || have <= 0) return;
  const carried = edibleGoodFormOf(ctx.content, goodType);
  if (tradeVehicleStock(world, cart.vehicle, ctx.content, carried, 1) !== 1) return;
  setAccessibleStockAmount(world, from, goodType, have - 1);
  if (!atForeignStop(world, trader, from)) return;
  const agreement = activeAgreement(world, trader, route);
  if (agreement === undefined || !sameFoodClass(ctx, carried, agreement.takeGood)) return;
  world.mut(trader, TradeRoute).received += 1;
  const player = ownerOf(world, trader);
  const partner = ownerOf(world, from);
  if (player !== undefined && partner !== undefined) recordGoodsTraded(world, player, partner, 1);
}

/**
 * Resolve one completed `cartUnload`: one unit of `goodType` leaves the cart's hold for `store`'s shelf,
 * on the slot the store banks it in; with no room left, or with no store, the unit goes onto the ground
 * at the trader's feet instead. At a foreign stop the unit counts toward the agreement's give. A
 * delivery that lands trains the trader.
 */
export function unloadCart(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  store: Entity | null,
  goodType: number,
): void {
  const route = world.tryGet(trader, TradeRoute);
  const cart = tradeCartOf(world, ctx, trader);
  if (route === undefined || cart === null) return;
  // A unit the store refuses goes onto the ground through the trader's hands, which must be free of
  // any other good first; a load still held from an earlier refusal keeps this unit aboard.
  const held = world.tryGet(trader, Carrying);
  if (held !== undefined && held.goodType !== goodType) return;
  if (tradeVehicleStock(world, cart.vehicle, ctx.content, goodType, -1) !== -1) return;
  if (store !== null && world.isAlive(store)) {
    const slot = bankedSlot(world, ctx, store, goodType);
    const have = stockOf(world, store, slot.goodType);
    if (have < slot.capacity) {
      setAccessibleStockAmount(world, store, slot.goodType, have + 1);
      grantTradeExperience(world, ctx, trader);
      if (atForeignStop(world, trader, store)) {
        const agreement = activeAgreement(world, trader, route);
        if (agreement !== undefined && sameFoodClass(ctx, goodType, agreement.giveGood)) {
          world.mut(trader, TradeRoute).given += 1;
        }
      }
      return;
    }
  }
  addCarry(world, trader, goodType, 1);
  dropCarryAtOwnTile(world, trader);
}
