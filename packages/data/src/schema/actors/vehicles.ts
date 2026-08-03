import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

export const VehicleType = z.strictObject({
  /** `vehicletype` `type` - the `logicvehicletype` namespace (1..N) the `jobEnablesVehicle` tech-graph
   *  edges and a `vehicle` building's `logicvehicletype` cross-reference into. */
  typeId: TypeId,
  /** Slug of `name`. Not unique - the real data ships two `oxcart` records (types 6 and 2) that slug
   *  alike; resolve a vehicle by `typeId`, the cross-ref key, not by `id`. */
  id: z.string(),
  name: z.string().optional(),
  /** `stockslots` - the vehicle's own hold capacity in goods units (handcart 15, oxcart 30, ship small
   *  50, ship big 200; the catapult 0). Distinct from a settler's personal carry. */
  stockSlots: z.number().int().nonnegative().default(0),
  /** `passengerslots` - how many settlers can ride (ships carry 9/19; carts and the catapult carry 0). */
  passengerSlots: z.number().int().nonnegative().default(0),
  /** `logicsize` - the vehicle's footprint/size class (0 = land cart, 1 = catapult, 2 = ship). */
  logicSize: z.number().int().nonnegative().default(0),
  /**
   * `logicgood` allow-list - the `goodtype` ids this vehicle's hold may carry, in file order. A repeated
   * single-value key (one `logicgood N` per line). The carts and both ships enumerate the full
   * haulable-goods set; the catapult lists none.
   */
  cargoGoods: z.array(TypeId).default([]),
  source: Provenance.optional(),
});
export type VehicleType = z.infer<typeof VehicleType>;
