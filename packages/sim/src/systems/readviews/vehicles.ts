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
 * is the `vehicle_ship` identity the plan names.
 *
 * source-basis: pinned to the extracted `passengerslots` param. The two ships are *also* the only rows with
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
 * source-basis n/a: a pure derived **read view** over the already-extracted vehicle IR (like {@link playableTribes}
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
 * source-basis: pinned to the extracted `stockslots` param; the unlock/pairing is deferred (source basis
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

/**
 * The set of **good types a vehicle's hold may carry** — the `cargoGoods` (`logicgood`) allow-list as
 * a membership `Set`, the "WHAT a boat-as-mobile-store can hold" cargo filter the Sea/Northland slice
 * gates loading on (distinct from {@link largestShipCapacity}, the "how *much*" capacity). A vehicle
 * with no `logicgood` (the catapult) yields an empty set — it carries no cargo. Applies to any vehicle,
 * not just ships (a cart's hold is filtered the same way); name kept generic.
 *
 * source-basis: pinned to the extracted `logicgood` param. In the real `vehicletypes.ini` the carts and both
 * ships enumerate the full haulable-goods list (49 ids) while the catapult lists none — so a membership
 * test against this set is the engine's "can this good ride in this hold" gate. Determinism: a pure `Set`
 * built from the already-extracted `cargoGoods` array; callers test membership (`.has`), which is
 * order-independent, so no canonical-iteration concern. No world, no RNG, no wall-clock.
 */
export function vehicleCargoGoods(vehicle: VehicleType): Set<number> {
  return new Set(vehicle.cargoGoods);
}

/**
 * Whether a vehicle's hold **may carry** a given `goodType` — membership in its `cargoGoods`
 * (`logicgood`) allow-list. The single-good predicate matching {@link vehicleCargoGoods}; the load gate
 * a boat-as-mobile-store (or a cart) checks before accepting a unit of cargo. False for any good on a
 * vehicle that lists no `logicgood` (the catapult carries nothing).
 *
 * source-basis: pinned to the extracted `logicgood` param (see {@link vehicleCargoGoods}). Determinism: a
 * pure array membership test over the already-extracted `cargoGoods`; no world, no RNG, no wall-clock.
 */
export function vehicleMayCarry(vehicle: VehicleType, goodType: number): boolean {
  return vehicle.cargoGoods.includes(goodType);
}

/**
 * A {@link VehicleType}'s **footprint/size class** — its extracted `logicSize` (`0` = a land cart,
 * `1` = the catapult/siege engine, `2` = a ship in the base data), the last extracted vehicle-table
 * field to get a read-side accessor and so the one that completes the vehicle-record consumer
 * coverage: every sibling field already has a reader — `stockSlots` via {@link largestShipCapacity}
 * (and the sim's `carrierCarryCapacity`), `passengerSlots` via {@link isShipVehicle}, `cargoGoods` via
 * {@link vehicleCargoGoods}/{@link vehicleMayCarry} — only `logicSize` was acknowledged-but-unread
 * (the {@link isShipVehicle} note flags that we key the boat test on `passengerSlots`, NOT `logicSize`).
 *
 * Note this is a *different, coarser* axis than {@link isShipVehicle}'s boat/cart split: the three
 * `logicSize` values partition all six base vehicles into cart `0` (handcart + the two oxcarts),
 * catapult `1`, and ship `2` — so it distinguishes the catapult from the carts (which `isShipVehicle`
 * lumps together as "not a ship"), and `logicSize === 2` is in fact a *third* independent signal that a
 * vehicle is a ship (converging with `passengerSlots > 0` and `logiccommander 24`, per the
 * {@link isShipVehicle} note). It is the per-vehicle footprint a deferred placement/rendering slice
 * would read to size a vehicle's tile occupancy; captured ahead of that drive as a plain accessor.
 *
 * Like {@link largestShipCapacity}'s `stockSlots` — and unlike the weapon/armor class-enum fields
 * (a weapon's `mainType`, which is `undefined` when absent) — `logicSize` is a quantity the schema
 * **defaults to `0`** (`z.number().int().nonnegative().default(0)`), so this returns a plain `number`,
 * never `undefined`. A vehicle with the smallest footprint reads `0` (a cart), the same value the source
 * carries, so there is no "no record" sentinel: `0` *is* the cart footprint — the weight-field
 * (`weaponWeightOf`/`armorWeightOf` in ./classes.ts) shape, not the class-enum-grouping shape.
 *
 * source-basis n/a: a pure field accessor over the already-extracted `logicSize` param (see
 * {@link VehicleType.logicSize}) — it adds no mechanic and invents no data (the `{0,1,2}` magnitudes are
 * the faithful `vehicletypes.ini` values the pipeline pinned). Determinism: a pure field read — no world,
 * no RNG, no wall-clock.
 */
export function vehicleSizeOf(vehicle: VehicleType): number {
  return vehicle.logicSize;
}
