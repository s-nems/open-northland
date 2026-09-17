import type { ContentSet, VehicleType } from '@open-northland/data';
import {
  VEHICLE_STOCK_BYTE_MAX,
  Vehicle,
  VehicleStock,
  type VehicleStockLine,
  vehicleLoad,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { edibleGoodFormOf } from '../readviews/food.js';

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

function lineOf(stock: { lines: Map<number, VehicleStockLine> }, good: number): VehicleStockLine {
  let line = stock.lines.get(good);
  if (line === undefined) {
    line = { current: 0, wanted: 0, reserved: 0 };
    stock.lines.set(good, line);
  }
  return line;
}

/**
 * Add `delta` units of `goodType` to the hold (`Stock_ModifyAmount`): the good is aliased, a negative
 * result is refused, the addition is clamped to the free budget, and a vehicle not riding a carrier
 * sets the good's wanted amount to the new actual one. Returns the units actually moved, 0 for a
 * refused or uncarriable good.
 */
export function modifyVehicleStock(
  world: World,
  vehicle: Entity,
  content: ContentSet,
  goodType: number,
  delta: number,
): number {
  const state = world.tryGet(vehicle, Vehicle);
  const stock = world.tryGet(vehicle, VehicleStock);
  if (state === undefined || stock === undefined) return 0;
  const type = contentIndex(content).vehicles.get(state.vehicleType);
  if (type === undefined) return 0;
  const good = vehicleStockGood(content, type, goodType);
  if (good === null) return 0;
  const have = stock.lines.get(good)?.current ?? 0;
  if (have + delta < 0) return 0;
  const room = vehicleLineCap(type) - vehicleLoad(stock);
  const moved = delta > 0 ? Math.min(delta, Math.max(0, room)) : delta;
  if (moved === 0) return 0;
  const line = lineOf(world.mut(vehicle, VehicleStock), good);
  line.current = have + moved;
  if (state.carrier === null) line.wanted = line.current;
  return moved;
}
