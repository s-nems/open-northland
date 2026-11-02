import type { ContentSet, VehicleType } from '@open-northland/data';
import {
  Settler,
  VEHICLE_STOCK_BYTE_MAX,
  Vehicle,
  VehicleStock,
  type VehicleStockLine,
  vehicleCommander,
  vehicleLoad,
  vehiclePassengers,
  vehicleReservedLoad,
  vehicleWantedLoad,
} from '../../components/index.js';
import { isFighterRole, jobRoleOfId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { isAdultSettler, isFemaleJobId } from '../family/eligibility.js';
import { edibleGoodFormOf } from '../readviews/food.js';

/** A hold as the world hands it out: read-only lines. */
type HoldView = { lines: ReadonlyMap<number, DeepReadonly<VehicleStockLine>> };

// The hold rules of docs/formats/VEHICLES.md "Cargo": one shared unit budget, a byte per allowed good,
// and dish goods aliased onto the edible a hold lists instead.

/**
 * The good a hold books `goodType` under: the good itself when the type lists it, else its edible form
 * when that is listed (the original aliases fruit, bread and fish onto `food_simple` and candy onto
 * `food_extra`; the shared dish seam adds meat and sausage, a named approximation), else null for a good
 * this vehicle cannot carry.
 */
export function vehicleStockGood(content: ContentSet, type: VehicleType, goodType: number): number | null {
  if (type.cargoGoods.includes(goodType)) return goodType;
  const edible = edibleGoodFormOf(content, goodType);
  return edible !== goodType && type.cargoGoods.includes(edible) ? edible : null;
}

/** The largest amount one line may book: the hold's budget, never above the byte. */
export function vehicleLineCap(type: VehicleType): number {
  return Math.min(type.stockSlots, VEHICLE_STOCK_BYTE_MAX);
}

/** The units aboard fill the budget. */
export function vehicleIsFull(type: VehicleType, stock: HoldView): boolean {
  return vehicleLoad(stock) >= vehicleLineCap(type);
}

/** The units booked fill the budget. */
export function vehicleIsFullSoon(type: VehicleType, stock: HoldView): boolean {
  return vehicleReservedLoad(stock) >= vehicleLineCap(type);
}

/**
 * Whether `rider` works `vehicle`'s hold: a rider of a loading trade in any seat, or the vehicle's
 * commander, whatever its trade (owner's choice: a trader's cart and a ship's crew load and unload
 * without a loader seated beside them). The trader a ship is pinned to works its hold through its route
 * alone, so a meal aboard never sends it ashore to restock.
 */
export function isCargoHand(world: World, content: ContentSet, vehicle: Entity, rider: Entity): boolean {
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined || state.hauler === rider) return false;
  if (vehicleCommander(state) === rider) return true;
  if (!state.passengers.some((seat) => seat !== null && seat.entity === rider)) return false;
  return isLoaderRider(world, content, rider);
}

/** A grown man of a loading trade: the cargo hand that fetches from anywhere its signpost area reaches. */
export function isLoaderRider(world: World, content: ContentSet, rider: Entity): boolean {
  return isAdultSettler(world, rider) && isLoaderJob(content, world.get(rider, Settler).jobType);
}

/**
 * Whether a grown person's trade loads and unloads a vehicle it rides: every man's trade but the
 * soldier's, hero's, scout's and druid's (owner's choice; the original loads with its carriers only).
 */
export function isLoaderJob(content: ContentSet, jobType: number | null): boolean {
  const job = jobType === null ? undefined : contentIndex(content).jobs.get(jobType);
  if (job === undefined || isFemaleJobId(job.id)) return false;
  const role = jobRoleOfId(job.id);
  return !isFighterRole(role) && role !== 'scout' && role !== 'druid';
}

/** Some rider of a loading trade sits in `vehicle`, in any seat. */
export function hasLoaderSeated(world: World, content: ContentSet, vehicle: Entity): boolean {
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined) return false;
  return vehiclePassengers(state).some((seat) => isLoaderRider(world, content, seat.entity));
}

/** Some rider works the hold: a loader seated anywhere, or a commander. */
export function hasCargoHand(world: World, content: ContentSet, vehicle: Entity): boolean {
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined) return false;
  return vehiclePassengers(state).some((seat) => isCargoHand(world, content, vehicle, seat.entity));
}

/**
 * Whether `rider` is a cargo hand of `vehicle` with a trip to make: a good booked past its wanted
 * amount, or one short of it while the hold is not full soon.
 */
export function cargoHandHasWork(world: World, content: ContentSet, vehicle: Entity, rider: Entity): boolean {
  const state = world.tryGet(vehicle, Vehicle);
  const stock = world.tryGet(vehicle, VehicleStock);
  const type = state === undefined ? undefined : contentIndex(content).vehicles.get(state.vehicleType);
  if (stock === undefined || type === undefined || !isCargoHand(world, content, vehicle, rider)) return false;
  let short = false;
  for (const line of stock.lines.values()) {
    if (line.wanted < line.reserved) return true;
    if (line.wanted > line.reserved) short = true;
  }
  return short && !vehicleIsFullSoon(type, stock);
}

function lineOf(stock: { lines: Map<number, VehicleStockLine> }, good: number): VehicleStockLine {
  let line = stock.lines.get(good);
  if (line === undefined) {
    line = { current: 0, wanted: 0, reserved: 0 };
    stock.lines.set(good, line);
  }
  return line;
}

interface Hold {
  readonly type: VehicleType;
  readonly good: number;
  readonly stock: HoldView;
}

/** The hold `goodType` books under on `vehicle`, or null when the vehicle cannot carry it. */
function holdOf(world: World, vehicle: Entity, content: ContentSet, goodType: number): Hold | null {
  const state = world.tryGet(vehicle, Vehicle);
  const stock = world.tryGet(vehicle, VehicleStock);
  if (state === undefined || stock === undefined) return null;
  const type = contentIndex(content).vehicles.get(state.vehicleType);
  if (type === undefined) return null;
  const good = vehicleStockGood(content, type, goodType);
  return good === null ? null : { type, good, stock };
}

/**
 * Add `delta` units of `goodType` to the hold: the good is aliased, a negative
 * result is refused, the addition is clamped to the free budget, and a vehicle with no cargo hand
 * seated sets the good's wanted amount to the new actual one. Returns the units actually moved, 0 for a
 * refused or uncarriable good. `reserved` is left alone: a carrier's delivery was booked when it set out.
 */
export function modifyVehicleStock(
  world: World,
  vehicle: Entity,
  content: ContentSet,
  goodType: number,
  delta: number,
): number {
  const hold = holdOf(world, vehicle, content, goodType);
  if (hold === null) return 0;
  const have = hold.stock.lines.get(hold.good)?.current ?? 0;
  if (have + delta < 0) return 0;
  const room = vehicleLineCap(hold.type) - vehicleLoad(hold.stock);
  const moved = delta > 0 ? Math.min(delta, Math.max(0, room)) : delta;
  if (moved === 0) return 0;
  const line = lineOf(world.mut(vehicle, VehicleStock), hold.good);
  line.current = have + moved;
  if (!hasCargoHand(world, content, vehicle)) line.wanted = line.current;
  return moved;
}

/**
 * Book or release `delta` units of `goodType`: a release below zero is
 * refused and a booking is clamped to the budget left over every good's reserved units. Returns the
 * units actually booked or released.
 */
export function modifyVehicleReserved(
  world: World,
  vehicle: Entity,
  content: ContentSet,
  goodType: number,
  delta: number,
): number {
  const hold = holdOf(world, vehicle, content, goodType);
  if (hold === null) return 0;
  const have = hold.stock.lines.get(hold.good)?.reserved ?? 0;
  if (have + delta < 0) return 0;
  const room = vehicleLineCap(hold.type) - vehicleReservedLoad(hold.stock);
  const moved = delta > 0 ? Math.min(delta, Math.max(0, room)) : delta;
  if (moved === 0) return 0;
  lineOf(world.mut(vehicle, VehicleStock), hold.good).reserved = have + moved;
  return moved;
}

/**
 * A puller's own load or unload of `delta` units of `goodType`, the write of a trader at a stop and of
 * a hauling cart's lifts: the units are booked and stowed in one step and the good's wanted amount
 * follows the actual one whatever crew is attached. Returns the units moved. Named approximation: the
 * original's trader books a unit on its walk to the door and stows it there, and its wanted-follows-
 * actual rule holds only while no cargo hand is seated; the trader is its cart's hand here, which would
 * flush its own trade cargo as surplus, so wanted stays on the actual amount.
 */
export function tradeVehicleStock(
  world: World,
  vehicle: Entity,
  content: ContentSet,
  goodType: number,
  delta: number,
): number {
  const hold = holdOf(world, vehicle, content, goodType);
  if (hold === null) return 0;
  const have = hold.stock.lines.get(hold.good)?.current ?? 0;
  if (have + delta < 0) return 0;
  const room = vehicleLineCap(hold.type) - vehicleLoad(hold.stock);
  const moved = delta > 0 ? Math.min(delta, Math.max(0, room)) : delta;
  if (moved === 0) return 0;
  const bookingRoom = vehicleLineCap(hold.type) - vehicleReservedLoad(hold.stock);
  const line = lineOf(world.mut(vehicle, VehicleStock), hold.good);
  line.current = have + moved;
  line.reserved = Math.max(
    0,
    line.reserved + (moved > 0 ? Math.min(moved, Math.max(0, bookingRoom)) : moved),
  );
  line.wanted = line.current;
  return moved;
}

/**
 * Use up one unit of `goodType` aboard, a passenger's meal: the unit leaves the hold and its booking.
 * The wanted amount stays for a seated cargo hand to restock at the next landing, and follows the actual
 * one without a hand, as any stock change does. False with none aboard.
 */
export function consumeVehicleGood(
  world: World,
  vehicle: Entity,
  content: ContentSet,
  goodType: number,
): boolean {
  const hold = holdOf(world, vehicle, content, goodType);
  const have = hold?.stock.lines.get(hold.good)?.current ?? 0;
  if (hold === null || have <= 0) return false;
  const line = lineOf(world.mut(vehicle, VehicleStock), hold.good);
  line.current = have - 1;
  line.reserved = Math.max(0, line.reserved - 1);
  if (!hasCargoHand(world, content, vehicle)) line.wanted = line.current;
  return true;
}

/**
 * Ask for `amount` units of `goodType`: clamped below at 0 and above so the
 * wanted amounts over every good stay within the budget. Returns false for an uncarriable good.
 */
export function setVehicleWanted(
  world: World,
  vehicle: Entity,
  content: ContentSet,
  goodType: number,
  amount: number,
): boolean {
  const hold = holdOf(world, vehicle, content, goodType);
  if (hold === null) return false;
  const have = hold.stock.lines.get(hold.good)?.wanted ?? 0;
  const cap = have + vehicleLineCap(hold.type) - vehicleWantedLoad(hold.stock);
  const wanted = Math.max(0, Math.min(amount, cap));
  if (wanted !== have) lineOf(world.mut(vehicle, VehicleStock), hold.good).wanted = wanted;
  return true;
}

/** Ask for nothing: every good's wanted amount to 0 (the original's `n` order). */
export function clearVehicleWanted(world: World, vehicle: Entity): void {
  const stock = world.tryGet(vehicle, VehicleStock);
  if (stock === undefined) return;
  let any = false;
  for (const line of stock.lines.values()) if (line.wanted > 0) any = true;
  if (!any) return;
  for (const line of world.mut(vehicle, VehicleStock).lines.values()) line.wanted = 0;
}

/**
 * Put `amount` units of `goodType` aboard that nobody is bringing, booked and stowed at once (a map's
 * `addgoods` and the loaded spawn of a scene): `current` rises by the units the budget takes and
 * `reserved` by as many as the booking budget still has. The original's stow then sets the
 * good's wanted amount to the new actual one while no cargo hand is seated, which at a spawn is always,
 * so the cargo is also asked for and a hand seated later neither fetches nor flushes it. Returns the
 * units stowed.
 */
export function stockVehicleGoods(
  world: World,
  vehicle: Entity,
  content: ContentSet,
  goodType: number,
  amount: number,
): number {
  const hold = holdOf(world, vehicle, content, goodType);
  if (hold === null || amount <= 0) return 0;
  const moved = Math.min(amount, Math.max(0, vehicleLineCap(hold.type) - vehicleLoad(hold.stock)));
  if (moved === 0) return 0;
  const booked = Math.min(moved, Math.max(0, vehicleLineCap(hold.type) - vehicleReservedLoad(hold.stock)));
  const line = lineOf(world.mut(vehicle, VehicleStock), hold.good);
  line.current += moved;
  line.reserved += booked;
  if (!hasCargoHand(world, content, vehicle)) line.wanted = line.current;
  return moved;
}

/**
 * A script's `AddGoodsToVehicle` on one vehicle: the amount is booked, stowed and added to the wanted
 * amount in turn, each under its own clamp, so a script's gift is also a standing request.
 */
export function addGoodsToVehicle(
  world: World,
  vehicle: Entity,
  content: ContentSet,
  goodType: number,
  amount: number,
): void {
  if (amount <= 0) return;
  modifyVehicleReserved(world, vehicle, content, goodType, amount);
  modifyVehicleStock(world, vehicle, content, goodType, amount);
  const hold = holdOf(world, vehicle, content, goodType);
  if (hold === null) return;
  const wanted = hold.stock.lines.get(hold.good)?.wanted ?? 0;
  setVehicleWanted(world, vehicle, content, goodType, wanted + amount);
}
