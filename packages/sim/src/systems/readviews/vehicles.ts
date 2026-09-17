import type { ContentSet, VehicleType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import type { Traversal } from '../../nav/terrain/index.js';

/**
 * A ship or boat rather than a land cart or siege engine, keyed on `vehicletypes.ini` `passengerslots`
 * because it is the semantic "carries people" param rather than a graphics footprint. Only the two ships
 * carry passengers; every cart and the catapult list 0.
 */
export function isShipVehicle(vehicle: VehicleType): boolean {
  return vehicle.passengerSlots > 0;
}

/** The ground a vehicle moves over: ships sail the water bodies, every other vehicle drives the land. */
export function vehicleTraversal(vehicle: VehicleType): Traversal {
  return isShipVehicle(vehicle) ? 'water' : 'land';
}

/**
 * A siege engine: the land vehicle with no hold, which is the catapult. The original keys the catapult's
 * doubled move period on its type id; the hold-less row is the same vehicle read from the data.
 */
export function isSiegeVehicle(vehicle: VehicleType): boolean {
  return !isShipVehicle(vehicle) && vehicle.stockSlots === 0;
}

/** Sorted ascending by `typeId`, so enumeration does not depend on declaration order. */
export function shipVehicles(content: ContentSet): VehicleType[] {
  return content.vehicles.filter(isShipVehicle).sort((a, b) => a.typeId - b.typeId);
}

/**
 * The maximum `stockslots` over the ship rows, or 0 when content ships none. Static content capacity, not
 * gated on a tribe's tech graph.
 */
export function largestShipCapacity(content: ContentSet): number {
  let best = 0;
  for (const vehicle of content.vehicles) {
    if (isShipVehicle(vehicle) && vehicle.stockSlots > best) best = vehicle.stockSlots;
  }
  return best;
}

/**
 * The `vehicle`-kind house a workshop raises to make `goodType`, or undefined for an ordinary ware. A
 * vehicle good is never crafted as a recipe cycle or shelved: its production is a hidden construction
 * site of this house beside the workshop (docs/formats/VEHICLES.md "Construction").
 */
export function vehicleHouseOfGood(content: ContentSet, goodType: number): number | undefined {
  return contentIndex(content).goods.get(goodType)?.vehicleHouse;
}
