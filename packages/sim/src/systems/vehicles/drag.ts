import type { ContentSet, VehicleType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { vehicleLineCap } from './stock.js';

// A laden cart drags: every map point it crosses, or every step of the carrier pulling it, takes longer
// by a share that grows with how full its hold is. A unit lifted into or out of a cart takes a share of
// the lifting clip by cart kind. Owner's feature, a named addition: the original moves a cart at the
// ground's period whatever it carries. The two kinds trade off (approximation, tuned by hand): the
// handcart lifts fast and drags hard, so it wins the short village haul where lifting is most of a trip;
// the ox cart lifts slow and barely drags, so it wins the long haul between settlements. With a 20-tick
// clip, full holds and 6- to 8-tick steps the two move the same goods per tick at about 20 to 30 nodes
// one way.

/** A cart: a land vehicle with a hold, so a handcart or an ox cart, and not the catapult or a ship. */
export function isCartType(type: VehicleType): boolean {
  return !isShipVehicle(type) && type.stockSlots > 0;
}

/** The speed a full handcart loses, in percent: it moves at 40% of its empty pace. */
export const HANDCART_FULL_SPEED_LOSS_PERCENT = 60;
/** The speed a full animal-drawn cart loses, in percent: far less than the handcart's, yet never nothing. */
export const DRAWN_CART_FULL_SPEED_LOSS_PERCENT = 15;
/** A unit's lift into or out of a handcart, in percent of the lifting clip's length. */
export const HANDCART_LIFT_PERCENT = 60;
/** A unit's lift into or out of an animal-drawn cart, in percent of the lifting clip's length. */
export const DRAWN_CART_LIFT_PERCENT = 130;
const PERCENT = 100;

/**
 * The speed `type` holding `load` units loses, in percent: nothing for an empty cart, a ship or the
 * catapult, else the full-cart loss of its kind times the share of the hold in use, rounded down to
 * whole percent.
 */
export function cartSpeedLossPercent(content: ContentSet, type: VehicleType, load: number): number {
  if (!isCartType(type) || load <= 0) return 0;
  const cap = vehicleLineCap(type);
  if (cap <= 0) return 0;
  const full = isAnimalDrawnType(content, type)
    ? DRAWN_CART_FULL_SPEED_LOSS_PERCENT
    : HANDCART_FULL_SPEED_LOSS_PERCENT;
  return loadSpeedLossPercent(full, load, cap);
}

/** The speed a cart whose full hold loses `fullLossPercent` loses holding `load` of `cap`, whole percent. */
export function loadSpeedLossPercent(fullLossPercent: number, load: number, cap: number): number {
  return Math.floor((fullLossPercent * Math.min(load, cap)) / cap);
}

/** The ticks one unit's lift into or out of a cart of `type` takes, the lifting clip lasting `clipTicks`;
 *  at least one tick. */
export function cartLiftTicks(content: ContentSet, type: VehicleType, clipTicks: number): number {
  const percent = isAnimalDrawnType(content, type) ? DRAWN_CART_LIFT_PERCENT : HANDCART_LIFT_PERCENT;
  return Math.max(1, Math.round((clipTicks * percent) / PERCENT));
}

/** The ticks a speed loss of `percent` adds to a move of `ticks`, so the move's pace falls by that
 *  share; rounded to whole ticks, so the move stays deterministic. */
export function cartDragTicks(ticks: number, percent: number): number {
  if (percent <= 0) return 0;
  return Math.round((ticks * percent) / (PERCENT - percent));
}

/** A cart an animal draws: the type a cart waiting for its draught animal turns into once harnessed. */
function isAnimalDrawnType(content: ContentSet, type: VehicleType): boolean {
  for (const other of contentIndex(content).vehicles.values()) {
    if (other.draggingAnimalTribe !== undefined && other.transformVehicleType === type.typeId) return true;
  }
  return false;
}
