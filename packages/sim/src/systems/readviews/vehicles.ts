import type { ContentSet, VehicleType } from '@open-northland/data';

/**
 * A ship or boat rather than a land cart or siege engine, keyed on `vehicletypes.ini` `passengerslots`
 * because it is the semantic "carries people" param rather than a graphics footprint. Only the two ships
 * carry passengers; every cart and the catapult list 0.
 */
export function isShipVehicle(vehicle: VehicleType): boolean {
  return vehicle.passengerSlots > 0;
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
 * The `logicgood` ids a hold may carry, for carts as well as ships. Carts and both ships enumerate the
 * full haulable-goods list while the catapult lists none, yielding an empty set.
 */
export function vehicleCargoGoods(vehicle: VehicleType): Set<number> {
  return new Set(vehicle.cargoGoods);
}

/** The single-good form of {@link vehicleCargoGoods}. */
export function vehicleMayCarry(vehicle: VehicleType, goodType: number): boolean {
  return vehicle.cargoGoods.includes(goodType);
}

/**
 * The extracted `logicSize` footprint class: 0 land cart, 1 catapult, 2 ship in the base data. The schema
 * defaults it to 0, so 0 is the cart footprint rather than a missing-record sentinel.
 */
export function vehicleSizeOf(vehicle: VehicleType): number {
  return vehicle.logicSize;
}
