import {
  CARRY_CAPACITY,
  Carrying,
  HaulingCart,
  isForeignHouse,
  ownerOf,
  Position,
  recordGoodsTraded,
  TradeRoute,
  TradeShip,
  Vehicle,
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
import { addCarry, dropCarryAtOwnTile, shrinkCarry } from '../settlers/atomics/effects/goods/carry.js';
import { cappedByStorageMinimum } from '../settlers/targets/stores/storage-reserve.js';
import { accessibleStockAmounts, bankedSlot, setAccessibleStockAmount } from '../stores/index.js';
import { isCartType } from '../vehicles/drag.js';
import { tradeVehicleStock, vehicleLineCap, vehicleStockGood } from '../vehicles/stock.js';
import { activeAgreement } from './agreements.js';
import { sameFoodClass } from './goods.js';

// Where a trader's route goods ride: the hold of the hauling cart it pulls as its tool, else its own
// hands, one unit a trip (owner's choice; the original's trader commands a cart and idles without one).
// A unit in the hands is a load like any other, so a hungry trader eats a food unit it carries. On a sea
// crossing its pinned ship's hold counts too (`FerryHold`).

/** How close to the stop's door the trader's hold must be before it works the stop, in map-point steps:
 *  the standing cart's anchor, or the trader itself while the cart travels with it or it goes on foot
 *  (original behavior: a hexagon distance over 5 moves the cart). */
export const TRADE_CART_HOUSE_DISTANCE = 5;

/**
 * A trader's hold as the trade decisions read it: the goods in it, ascending by good, and the room left.
 * `cart` is the hauling cart whose hold it is, null for the trader's hands.
 */
export interface TraderHold {
  readonly cart: Entity | null;
  /** `[good, units]` for every good held with at least one unit. */
  readonly entries: ReadonlyArray<readonly [number, number]>;
  readonly load: number;
  readonly room: number;
  /** The most units the hold takes at once, its load included. */
  readonly capacity: number;
  amount(good: number): number;
  /** Whether the hold takes `good` at all: a cart by its `logicgood` list, dishes through their edible
   *  form; the hands take any good. */
  carries(good: number): boolean;
}

/**
 * The route's goods on a sea crossing, in the pinned ship and the near hold together: the decisions read
 * one hold, while units move through the near hold alone (`loadTraderHold`, `unloadTraderHold`). A good
 * rides only if both can take it, and a ship's good the near hold refuses stays out of `entries`, since
 * no lift could bring it ashore.
 */
export interface FerryHold extends TraderHold {
  readonly ship: Entity;
  /** The cart or hands, as {@link traderHoldOf} reads them. */
  readonly near: TraderHold;
  /** The ship's hold alone, `cart` naming the ship. */
  readonly aboard: TraderHold;
}

/** The trader's own hauling cart with a hold, or null for a trader on foot. */
function haulingCartOf(world: World, ctx: ContentContext, trader: Entity): Entity | null {
  const vehicle = world.tryGet(trader, HaulingCart)?.vehicle;
  if (vehicle === undefined || !world.has(vehicle, VehicleStock)) return null;
  const type = contentIndex(ctx.content).vehicles.get(world.get(vehicle, Vehicle).vehicleType);
  return type !== undefined && isCartType(type) ? vehicle : null;
}

/** A detached read of the trader's hold for one decision. */
export function traderHoldOf(world: World, ctx: ContentContext, trader: Entity): TraderHold {
  const cart = haulingCartOf(world, ctx, trader);
  if (cart === null) {
    const held = world.tryGet(trader, Carrying);
    const load = held?.amount ?? 0;
    return {
      cart,
      entries: held !== undefined && load > 0 ? [[held.goodType, load]] : [],
      load,
      room: Math.max(0, CARRY_CAPACITY - load),
      capacity: CARRY_CAPACITY,
      amount: (good) => (held?.goodType === good ? load : 0),
      carries: () => true,
    };
  }
  return vehicleHoldOf(world, ctx, cart);
}

/** A detached read of `vehicle`'s own hold, as a hold of `cart` naming it. */
function vehicleHoldOf(world: World, ctx: ContentContext, vehicle: Entity): TraderHold {
  const type = contentIndex(ctx.content).vehicles.get(world.get(vehicle, Vehicle).vehicleType);
  const stock = world.get(vehicle, VehicleStock);
  const entries = vehicleStockEntries(stock).flatMap(
    ([good, line]): Array<readonly [number, number]> => (line.current > 0 ? [[good, line.current]] : []),
  );
  const load = vehicleLoad(stock);
  const capacity = type === undefined ? 0 : vehicleLineCap(type);
  return {
    cart: vehicle,
    entries,
    load,
    room: Math.max(0, capacity - load),
    capacity,
    amount: (good) => stock.lines.get(good)?.current ?? 0,
    carries: (good) => type !== undefined && vehicleStockGood(ctx.content, type, good) !== null,
  };
}

/** The trader's hold merged with its pinned `ship`'s, or the near hold alone for a ship with no hold. */
export function ferryHoldOf(
  world: World,
  ctx: ContentContext,
  near: TraderHold,
  ship: Entity,
): FerryHold | null {
  if (!world.has(ship, VehicleStock)) return null;
  const aboard = vehicleHoldOf(world, ctx, ship);
  const merged = new Map<number, number>(near.entries);
  for (const [good, units] of aboard.entries) {
    if (near.carries(good)) merged.set(good, (merged.get(good) ?? 0) + units);
  }
  return {
    cart: near.cart,
    entries: [...merged].sort(([a], [b]) => a - b),
    load: near.load + aboard.load,
    room: near.room + aboard.room,
    capacity: near.capacity + aboard.capacity,
    amount: (good) => near.amount(good) + aboard.amount(good),
    carries: (good) => near.carries(good) && aboard.carries(good),
    ship,
    near,
    aboard,
  };
}

/** Whether the trader's hauling cart stands on the map rather than travelling in its hands. */
export function cartStands(world: World, hold: TraderHold): boolean {
  return hold.cart !== null && world.has(hold.cart, Position);
}

/** Move `units` of `good` into the trader's hold (negative: out of it); the units actually moved. */
function moveThroughHold(
  world: World,
  ctx: ContentContext,
  trader: Entity,
  good: number,
  units: number,
): number {
  const cart = haulingCartOf(world, ctx, trader);
  if (cart !== null) return tradeVehicleStock(world, cart, ctx.content, good, units);
  const held = world.tryGet(trader, Carrying);
  if (units > 0) {
    if (held !== undefined && (held.goodType !== good || held.amount + units > CARRY_CAPACITY)) return 0;
    addCarry(world, trader, good, units);
    return units;
  }
  if (held === undefined || held.goodType !== good || held.amount < -units) return 0;
  shrinkCarry(world, trader, held, -units);
  return units;
}

/** Whether `ship` is the trader's pinned ship, lying moored so its door takes a unit. */
function liftsAtShip(world: World, trader: Entity, ship: Entity): boolean {
  return world.tryGet(trader, TradeShip)?.vehicle === ship && world.tryGet(ship, Vehicle)?.moored === true;
}

/** Resolve one completed `tradeShipStow`: one unit of `goodType` out of the near hold into the pinned
 *  ship's. A unit the ship refuses stays where it is. */
export function stowIntoTradeShip(
  world: World,
  ctx: ContentContext,
  trader: Entity,
  ship: Entity,
  goodType: number,
): void {
  if (!liftsAtShip(world, trader, ship) || traderHoldOf(world, ctx, trader).amount(goodType) <= 0) return;
  if (tradeVehicleStock(world, ship, ctx.content, goodType, 1) === 1) {
    moveThroughHold(world, ctx, trader, goodType, -1);
  }
}

/** Resolve one completed `tradeShipFetch`: one unit of `goodType` out of the pinned ship's hold into the
 *  near hold. A unit the near hold has no room for stays aboard. */
export function fetchFromTradeShip(
  world: World,
  ctx: ContentContext,
  trader: Entity,
  ship: Entity,
  goodType: number,
): void {
  if (!liftsAtShip(world, trader, ship)) return;
  const near = traderHoldOf(world, ctx, trader);
  if (near.room <= 0 || !near.carries(goodType)) return;
  if (tradeVehicleStock(world, ship, ctx.content, goodType, -1) !== -1) return;
  if (moveThroughHold(world, ctx, trader, goodType, 1) !== 1) {
    tradeVehicleStock(world, ship, ctx.content, goodType, 1);
  }
}

/** Whether the trader is at the stop of another player's house, where the exchange is counted. */
function atForeignStop(world: World, trader: Entity, house: Entity): boolean {
  const route = world.tryGet(trader, TradeRoute);
  return route?.stops.some((stop) => stop.house === house) === true && isForeignHouse(world, trader, house);
}

/**
 * Resolve one completed `tradeLoad`: one unit of `goodType` leaves `from`'s shelf for the trader's hold,
 * in the form it takes outside the house (a dish becomes its edible). At a foreign stop the unit counts
 * toward the agreement's take and the player's trade tally with the house's owner. A full hold, a good
 * the hold refuses or a shelf already empty moves nothing.
 */
export function loadTraderHold(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  from: Entity,
  goodType: number,
): void {
  const route = world.tryGet(trader, TradeRoute);
  if (route === undefined) return;
  const stock = accessibleStockAmounts(world, from);
  const have = stock?.get(goodType) ?? 0;
  if (stock === undefined || cappedByStorageMinimum(world, ctx, from, goodType, have) <= 0) return;
  const carried = edibleGoodFormOf(ctx.content, goodType);
  if (moveThroughHold(world, ctx, trader, carried, 1) !== 1) return;
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
 * Resolve one completed `tradeUnload`: one unit of `goodType` leaves the trader's hold for `store`'s
 * shelf, on the slot the store banks it in; with no room left, or with no store, the unit goes onto the
 * ground at the trader's feet instead. At a foreign stop the unit counts toward the agreement's give. A
 * delivery that lands trains the trader.
 */
export function unloadTraderHold(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  store: Entity | null,
  goodType: number,
): void {
  const route = world.tryGet(trader, TradeRoute);
  if (route === undefined) return;
  const cart = haulingCartOf(world, ctx, trader);
  // A unit the store refuses goes onto the ground through the trader's hands, which must be free of
  // any other good first; a load still held from an earlier refusal keeps this unit in the cart.
  const held = world.tryGet(trader, Carrying);
  if (cart !== null && held !== undefined && held.goodType !== goodType) return;
  if (moveThroughHold(world, ctx, trader, goodType, -1) !== -1) return;
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
  dropCarryAtOwnTile(world, ctx, trader);
}
