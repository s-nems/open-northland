import type { ContentSet, VehicleType } from '@open-northland/data';
import {
  Settler,
  VEHICLE_STOCK_BYTE_MAX,
  Vehicle,
  VehicleStock,
  type VehicleStockLine,
  vehicleLoad,
  vehiclePassengers,
  vehicleReservedLoad,
  vehicleWantedLoad,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { edibleGoodFormOf } from '../readviews/food.js';
import { isCarrierJobRow } from '../readviews/jobs.js';

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

/** `Stock_IsFull`: the units aboard fill the budget. */
export function vehicleIsFull(type: VehicleType, stock: HoldView): boolean {
  return vehicleLoad(stock) >= vehicleLineCap(type);
}

/** `Stock_IsFullSoon`: the units booked fill the budget. */
export function vehicleIsFullSoon(type: VehicleType, stock: HoldView): boolean {
  return vehicleReservedLoad(stock) >= vehicleLineCap(type);
}

/** `Passengers_IsCarrierAttached`: a rider of the carrier trade holds any seat, aboard or on its way. */
export function hasCarrierAttached(world: World, content: ContentSet, vehicle: Entity): boolean {
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined) return false;
  const jobs = contentIndex(content).jobs;
  return vehiclePassengers(state).some((seat) => {
    const jobType = world.tryGet(seat.entity, Settler)?.jobType;
    if (jobType === undefined || jobType === null) return false;
    const job = jobs.get(jobType);
    return job !== undefined && isCarrierJobRow(job);
  });
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
 * Add `delta` units of `goodType` to the hold (`Stock_ModifyAmount`): the good is aliased, a negative
 * result is refused, the addition is clamped to the free budget, and a vehicle with no carrier attached
 * sets the good's wanted amount to the new actual one. Returns the units actually moved, 0 for a
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
  if (!hasCarrierAttached(world, content, vehicle)) line.wanted = line.current;
  return moved;
}

/**
 * Book or release `delta` units of `goodType` (`Stock_ModifyFutureAmount`): a release below zero is
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
 * Ask for `amount` units of `goodType` (`Stock_SetWantedAmount`): clamped below at 0 and above so the
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
 * `reserved` by as many as the booking budget still has; `wanted` stays. Returns the units stowed.
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
