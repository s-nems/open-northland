import type { ContentSet, VehicleType } from '@vinland/data';

// Pure, terminal **read views** for vehicles — the data-defined ship/boat classification the upcoming
// Sea/Northland slice (water travel, boats as mobile stores, embark/disembark) builds on. No mechanic
// is added here (nothing embarks, no store moves); see ./index.ts for why read views are grouped out
// of systems/shared.ts.

/**
 * Whether a {@link VehicleType} is a **ship/boat** — a water-borne vehicle that ferries passengers,
 * as opposed to a land cart (`handcart`/`oxcart`) or a siege engine (`catapult`). The discriminator is
 * `passengerSlots > 0`: in the real `vehicletypes.ini` the only rows that carry passengers are the two
 * ships (`ship small` `passengerslots 19`, `ship big` `passengerslots 9`) — every cart and the catapult
 * list `passengerslots 0`. A ship is precisely "a vehicle that transports people (across water)", which
 * is the `vehicle_ship` identity the roadmap names.
 *
 * FIDELITY: pinned to the extracted `passengerslots` param. The two ships are *also* the only rows with
 * `logicsize 2` (carts `0`, catapult `1`) and `logiccommander 24` (a ship pilot, carts use `25`,
 * catapult `31`) — three independent signals converge, so `passengerSlots > 0` is a sound reading and
 * not a coincidence of the synthetic fixture. We key on `passengerSlots` (not `logicSize`) because it is
 * the *semantic* "carries people = a boat" param rather than a graphics footprint. Adds no mechanic
 * (nothing produced/consumed/moved) — a derived classification over the already-extracted vehicle IR.
 */
export function isShipVehicle(vehicle: VehicleType): boolean {
  return vehicle.passengerSlots > 0;
}

/**
 * The **ship/boat vehicle types** as a derived **read view** over `content` — the `vehicle_ship` rows a
 * tribe can field for sea travel, distinguished from land carts *by the data alone* ({@link isShipVehicle}:
 * the only vehicles with `passengerslots > 0`). This is the data-defined seed the Sea/Northland items
 * (water valency, boats as mobile stores, embark/disembark, `fisher_sea`/`trader_sea`) build on, with
 * nothing hardcoded — a real ship set is the same shape with more rows.
 *
 * Returned as a {@link VehicleType} **array** sorted ascending by `typeId` (not a Map keyed by id) so the
 * enumeration order is stable regardless of `content.vehicles` declaration order — the canonical order a
 * "for each ship type" loop wants. {@link isShipVehicle} is the matching single-vehicle predicate.
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted vehicle IR (like {@link playableTribes}
 * over tribes) — it adds no mechanic and invents no classification: the ship-vs-cart split is read straight
 * off the `passengerslots` param the pipeline pinned (see {@link isShipVehicle}). Determinism: a pure
 * function of `content` (no world, no RNG, no wall-clock) over the plain `content.vehicles` array,
 * explicitly **sorted** by `typeId`, so the same content yields a byte-identical array every call.
 */
export function shipVehicles(content: ContentSet): VehicleType[] {
  return content.vehicles.filter(isShipVehicle).sort((a, b) => a.typeId - b.typeId);
}

/**
 * The largest **ship cargo capacity** a tribe could field — the maximum `stockSlots` over the ship
 * vehicle types ({@link shipVehicles}), or `0` when no ship exists. This is the "boats as mobile stores"
 * capacity the Sea/Northland item names: a ship is a mobile stockpile, sized (like a cart in
 * `carrierCarryCapacity`) by its `stockSlots` (`ship small` `50`, `ship big` `200`). Unlike
 * `carrierCarryCapacity` this is the *static* content capacity — it does NOT gate on a tribe's tech graph
 * (no `jobEnablesVehicle`/live-settler check); the unlock side rides on the later boat-entity slice.
 *
 * FIDELITY: pinned to the extracted `stockslots` param; the unlock/pairing is deferred (docs/FIDELITY.md
 * — *Carrier→vehicle pairing*). Determinism: a pure max over `content.vehicles` (associative/commutative,
 * scan order can't change the result); no RNG, no wall-clock.
 */
export function largestShipCapacity(content: ContentSet): number {
  let best = 0;
  for (const vehicle of content.vehicles) {
    if (isShipVehicle(vehicle) && vehicle.stockSlots > best) best = vehicle.stockSlots;
  }
  return best;
}
