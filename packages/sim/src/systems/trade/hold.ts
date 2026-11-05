import {
  CARRY_CAPACITY,
  CargoRun,
  Carrying,
  HaulingCart,
  isForeignHouse,
  ownerOf,
  Position,
  Rider,
  recordGoodsTraded,
  TradeRoute,
  TradeShip,
  Vehicle,
  VehicleStock,
  vehicleLoad,
  vehiclePassengers,
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
import { abandonCargoRun } from '../vehicles/cargo.js';
import { pinnedTraderOf } from '../vehicles/crew.js';
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
  /** The units a pinned ship's helpers have under way at the current stop. */
  readonly helpers: HelperFlight;
}

/** What the helpers of a pinned ship have under way, by good: units in neither the ship nor the house. */
export interface HelperFlight {
  /** Units bound for the stop's house, on a helper's back or on its run to lift them out of the ship. */
  toHouse(good: number): number;
  /** Units a helper walks to lift, still on the house's shelf. */
  toLift(good: number): number;
}

export const NO_HELPERS: HelperFlight = { toHouse: () => 0, toLift: () => 0 };

/**
 * The route's goods on a sea crossing, in the pinned ship and the near hold together: the decisions read
 * one hold, the ship's share as booked by its helpers' runs, while units move through the near hold alone
 * (`loadTraderHold`, `unloadTraderHold`). A good rides only if both can take it, and a ship's good the
 * near hold refuses stays out of `entries`, since no lift could bring it ashore.
 */
export interface FerryHold extends TraderHold {
  readonly ship: Entity;
  /** The cart or hands, as {@link traderHoldOf} reads them. */
  readonly near: TraderHold;
  /** The ship's hold alone, `cart` naming the ship: the units physically aboard. */
  readonly aboard: TraderHold;
  /** The ship's hold as booked: aboard, plus the helpers' `load` runs, less their `unload` runs. A pinned
   *  ship's own lines keep `reserved` on `current`; the seated helpers' runs are the one record. */
  readonly booked: TraderHold;
  /** The units of `good` a lift may take out of the ship: aboard and on no helper's run. */
  liftable(good: number): number;
  /** Whether a seated helper ashore is on a trip, a run or a unit in hand. The trader waits it out rather
   *  than sail with a unit booked and not yet moved; a helper holding a unit finishes its trip, through a
   *  need if one takes it first, so the wait is bounded, and it stands in for the ship waiting for that
   *  helper at departure. An empty-handed helper gives its run back when a need takes it. */
  readonly helpersOnTrips: boolean;
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
      helpers: NO_HELPERS,
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
    helpers: NO_HELPERS,
  };
}

/** `aboard` as the helpers' runs book it, `runs` by hold line. A line a meal emptied under a run books
 *  no less than nothing. */
function bookedHoldOf(aboard: TraderHold, runs: ReadonlyMap<number, number>): TraderHold {
  const units = new Map<number, number>(aboard.entries);
  for (const [good, run] of runs) units.set(good, Math.max(0, (units.get(good) ?? 0) + run));
  const entries = [...units].filter(([, held]) => held > 0).sort(([a], [b]) => a - b);
  const load = entries.reduce((sum, [, held]) => sum + held, 0);
  return {
    ...aboard,
    entries,
    load,
    room: Math.max(0, aboard.capacity - load),
    amount: (good) => units.get(good) ?? 0,
  };
}

/** What `ship`'s helpers on the map have under way, read off its seats once per decision: `runs` nets
 *  their runs by hold line, `load` adding a unit and `unload` taking one away. */
function helperFlightOf(
  world: World,
  ctx: ContentContext,
  ship: Entity,
): {
  readonly flight: HelperFlight;
  readonly runs: ReadonlyMap<number, number>;
  readonly onTrips: boolean;
} {
  const runs = new Map<number, number>();
  let onTrips = false;
  const toHouse = new Map<number, number>();
  const toLift = new Map<number, number>();
  const count = (units: Map<number, number>, good: number): void => {
    const key = edibleGoodFormOf(ctx.content, good);
    units.set(key, (units.get(key) ?? 0) + 1);
  };
  const state = world.get(ship, Vehicle);
  for (const seat of vehiclePassengers(state)) {
    if (seat.inside || seat.entity === state.hauler) continue;
    const run = world.tryGet(seat.entity, CargoRun);
    const held = world.tryGet(seat.entity, Carrying);
    const loaded = held !== undefined && held.amount > 0;
    onTrips ||= run !== undefined || loaded;
    if (run !== undefined) {
      const net = run.direction === 'load' ? 1 : -1;
      runs.set(run.goodType, (runs.get(run.goodType) ?? 0) + net);
    }
    if (run?.direction === 'load') {
      if (!loaded) count(toLift, run.goodType);
    } else if (run !== undefined) count(toHouse, run.goodType);
    else if (loaded) count(toHouse, held.goodType);
  }
  const unitsIn =
    (units: ReadonlyMap<number, number>) =>
    (good: number): number =>
      units.get(edibleGoodFormOf(ctx.content, good)) ?? 0;
  return { flight: { toHouse: unitsIn(toHouse), toLift: unitsIn(toLift) }, runs, onTrips };
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
  const { flight, runs, onTrips } = helperFlightOf(world, ctx, ship);
  const booked = bookedHoldOf(aboard, runs);
  const merged = new Map<number, number>(near.entries);
  for (const [good, units] of booked.entries) {
    if (near.carries(good)) merged.set(good, (merged.get(good) ?? 0) + units);
  }
  return {
    cart: near.cart,
    entries: [...merged].sort(([a], [b]) => a - b),
    load: near.load + booked.load,
    room: near.room + booked.room,
    capacity: near.capacity + aboard.capacity,
    amount: (good) => near.amount(good) + booked.amount(good),
    carries: (good) => near.carries(good) && aboard.carries(good),
    helpers: flight,
    ship,
    near,
    aboard,
    booked,
    liftable: (good) => Math.min(aboard.amount(good), booked.amount(good)),
    helpersOnTrips: onTrips,
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

/** Whether `lifter` works `ship`, the pinned ship of a trader or a helper's, lying moored so its door
 *  takes a unit. */
function liftsAtShip(world: World, lifter: Entity, ship: Entity): boolean {
  if (world.tryGet(ship, Vehicle)?.moored !== true) return false;
  if (world.tryGet(lifter, TradeShip)?.vehicle === ship) return true;
  return world.tryGet(lifter, Rider)?.vehicle === ship && pinnedTraderOf(world, ship) !== null;
}

/** Resolve one completed `tradeShipStow`: one unit of `goodType` out of the near hold into the pinned
 *  ship's, ending a helper's run. A unit the ship refuses stays where it is. */
export function stowIntoTradeShip(
  world: World,
  ctx: ContentContext,
  lifter: Entity,
  ship: Entity,
  goodType: number,
): void {
  if (!liftsAtShip(world, lifter, ship) || traderHoldOf(world, ctx, lifter).amount(goodType) <= 0) return;
  abandonCargoRun(world, lifter);
  if (tradeVehicleStock(world, ship, ctx.content, goodType, 1) === 1) {
    moveThroughHold(world, ctx, lifter, goodType, -1);
  }
}

/** Resolve one completed `tradeShipFetch`: one unit of `goodType` out of the pinned ship's hold into the
 *  near hold, ending a helper's run. A unit the near hold has no room for stays aboard. */
export function fetchFromTradeShip(
  world: World,
  ctx: ContentContext,
  lifter: Entity,
  ship: Entity,
  goodType: number,
): void {
  if (!liftsAtShip(world, lifter, ship)) return;
  const near = traderHoldOf(world, ctx, lifter);
  if (near.room <= 0 || !near.carries(goodType)) return;
  abandonCargoRun(world, lifter);
  if (tradeVehicleStock(world, ship, ctx.content, goodType, -1) !== -1) return;
  if (moveThroughHold(world, ctx, lifter, goodType, 1) !== 1) {
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
