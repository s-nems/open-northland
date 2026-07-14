import type { ContentSet, VehicleType } from '@open-northland/data';

// Pure read views over the extracted vehicle IR — the data-defined ship/boat classification the Sea/Northland
// slice (water travel, boats as mobile stores, embark/disembark) builds on. No mechanic here; see ./index.ts
// for why read views are grouped together.

/**
 * Whether a {@link VehicleType} is a ship/boat rather than a land cart or a siege engine.
 *
 * source-basis: the extracted `passengerslots` param. In `vehicletypes.ini` only the two ships carry
 * passengers (`ship small` 19, `ship big` 9); every cart and the catapult list 0. The ships are also the only
 * rows with `logicsize 2` and `logiccommander 24`, so three independent signals converge. Keyed on
 * `passengerSlots` rather than `logicSize` because it is the semantic "carries people" param, not a graphics
 * footprint.
 */
export function isShipVehicle(vehicle: VehicleType): boolean {
  return vehicle.passengerSlots > 0;
}

/**
 * The ship vehicle types a tribe can field, sorted ascending by `typeId` so enumeration order is stable
 * regardless of `content.vehicles` declaration order. {@link isShipVehicle} is the single-vehicle predicate.
 */
export function shipVehicles(content: ContentSet): VehicleType[] {
  return content.vehicles.filter(isShipVehicle).sort((a, b) => a.typeId - b.typeId);
}

/**
 * The largest ship cargo capacity in content — the maximum `stockSlots` over {@link shipVehicles} (`ship
 * small` 50, `ship big` 200), or 0 when no ship exists. Unlike `carrierCarryCapacity` this is the static
 * content capacity: it does not gate on a tribe's tech graph, since the unlock rides on the later boat-entity
 * slice.
 *
 * source-basis: the extracted `stockslots` param.
 */
export function largestShipCapacity(content: ContentSet): number {
  let best = 0;
  for (const vehicle of content.vehicles) {
    if (isShipVehicle(vehicle) && vehicle.stockSlots > best) best = vehicle.stockSlots;
  }
  return best;
}

/**
 * The good types a vehicle's hold may carry, as a membership set — the "what" filter beside
 * {@link largestShipCapacity}'s "how much". A vehicle with no `logicgood` (the catapult) yields an empty set.
 * Applies to carts as well as ships.
 *
 * source-basis: the extracted `logicgood` param — carts and both ships enumerate the full haulable-goods list
 * (49 ids) while the catapult lists none.
 */
export function vehicleCargoGoods(vehicle: VehicleType): Set<number> {
  return new Set(vehicle.cargoGoods);
}

/** Whether a vehicle's hold may carry `goodType` — the single-good form of {@link vehicleCargoGoods}. */
export function vehicleMayCarry(vehicle: VehicleType, goodType: number): boolean {
  return vehicle.cargoGoods.includes(goodType);
}

/**
 * A {@link VehicleType}'s footprint/size class: the extracted `logicSize` (0 = land cart, 1 = catapult,
 * 2 = ship in the base data). A coarser axis than {@link isShipVehicle}'s boat/cart split — it separates the
 * catapult from the carts, which that predicate lumps together as "not a ship".
 *
 * The schema defaults `logicSize` to 0, so this returns a plain number: 0 *is* the cart footprint, not a "no
 * record" sentinel (unlike a weapon's `mainType`, which is `undefined` when absent). Read by a deferred
 * placement/rendering slice to size a vehicle's tile occupancy.
 */
export function vehicleSizeOf(vehicle: VehicleType): number {
  return vehicle.logicSize;
}
