import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

export const VehicleType = z.strictObject({
  /** `vehicletype` `type` — the `logicvehicletype` namespace (1..N) the `jobEnablesVehicle` tech-graph
   *  edges and a `vehicle` building's `logicvehicletype` cross-reference into. */
  typeId: TypeId,
  /** Slug of `name`. Not unique — the real data ships two `oxcart` records (types 6 and 2) that slug
   *  alike; resolve a vehicle by `typeId` (the cross-ref key), not `id`, as with {@link WeaponType}. */
  id: z.string(),
  name: z.string().optional(),
  /**
   * `stockslots` — how many goods units the vehicle can haul at once: its hold capacity (handcart 15,
   * oxcart 30, ship small 50, ship big 200; the catapult carries 0). A settler on foot always carries a
   * single unit (`Settler.CARRY_CAPACITY`); this larger capacity belongs to the vehicle itself and is
   * consumed today only by the ship-cargo readview (`maxShipCargo`/`shipVehicles`). Wiring a cart/vehicle
   * as an entity with its own hold — so a hauler fetches and parks one — is the deferred vehicle-entity
   * slice; it must model the vehicle's hold, never inflate a person's personal carry. Defaults 0 (no
   * record observed without it).
   */
  stockSlots: z.number().int().nonnegative().default(0),
  /** `passengerslots` — how many settlers can ride (ships carry 9/19; carts and the catapult carry 0). */
  passengerSlots: z.number().int().nonnegative().default(0),
  /** `logicsize` — the vehicle's footprint/size class (0 = land cart, 1 = catapult, 2 = ship). */
  logicSize: z.number().int().nonnegative().default(0),
  /**
   * `logicgood` allow-list — the `goodtype` ids this vehicle's hold may carry, in file order. A
   * repeated single-value key (one `logicgood N` per line). The carts and both ships enumerate the
   * full haulable-goods set; the catapult lists none (it carries no cargo). This is the "what a
   * boat-as-mobile-store can hold" cargo filter the Sea/Northland slice consumes — distinct from
   * {@link stockSlots} (how much it holds). Empty when the section lists no `logicgood`.
   */
  cargoGoods: z.array(TypeId).default([]),
  source: Provenance.optional(),
});
export type VehicleType = z.infer<typeof VehicleType>;
