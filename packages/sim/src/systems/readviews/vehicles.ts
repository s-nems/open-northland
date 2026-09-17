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
