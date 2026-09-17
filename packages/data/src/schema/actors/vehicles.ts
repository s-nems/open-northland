import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

/** `passengervector <direction> <distance>`: the door lies `distance` steps from the vehicle at
 *  facing offset `direction`; `distance` is also the ring a dock click searches. Ships author it. */
export const VehicleDoorVector = z.strictObject({
  direction: z.number().int(),
  distance: z.number().int().nonnegative(),
});
export type VehicleDoorVector = z.infer<typeof VehicleDoorVector>;

export const VehicleType = z.strictObject({
  /** `vehicletype` `type` - the `logicvehicletype` namespace (1..N) the `jobEnablesVehicle` tech-graph
   *  edges and a `vehicle` building's `vehicleType` cross-reference into. */
  typeId: TypeId,
  /** Slug of `name`, unique across the table: the two `oxcart` records slug `oxcart` (type 2) and
   *  `cart_no_ox` (type 6, its `logicdefines.inc` name). Cross-references still key on `typeId`. */
  id: z.string(),
  name: z.string().optional(),
  /** The `JOB_TYPE_VEHICLE_*` job id (`typeId + 49` in `logicdefines.inc`) the animation and graphics
   *  tables key this vehicle's rows on, and the id `passengerJobs` names a carried vehicle by. */
  jobId: TypeId,
  /** `stockslots` - the vehicle's own hold capacity in goods units (handcart 15, oxcart 30, ship small
   *  50, ship big 200; the catapult 0). Distinct from a settler's personal carry. */
  stockSlots: z.number().int().nonnegative().default(0),
  /** `passengerslots` - ordinary passenger slots (ships 19/9; carts and the catapult 0). The commander
   *  takes one more slot beyond these. */
  passengerSlots: z.number().int().nonnegative().default(0),
  /** `logicsize` - the vehicle's footprint/size class (0 = land cart, 1 = catapult, 2 = ship). */
  logicSize: z.number().int().nonnegative().default(0),
  /**
   * `logicgood` allow-list - the `goodtype` ids this vehicle's hold may carry, in file order. A repeated
   * single-value key (one `logicgood N` per line). The carts and both ships enumerate the full
   * haulable-goods set; the catapult lists none.
   */
  cargoGoods: z.array(TypeId).default([]),
  /** `logicpassenger` allow-list - the job ids that may attach, in file order. A ship's list also
   *  names the vehicle job ids (50, 51, 54) it may carry. Type 6 lists none. */
  passengerJobs: z.array(TypeId).default([]),
  /** `vehicleslots` - carried-vehicle slots (small ship 1, big ship 0). */
  vehicleSlots: z.number().int().nonnegative().default(0),
  /** `passengervector`, absent on the carts and the catapult. */
  passengerVector: VehicleDoorVector.optional(),
  /** `logicdragginganimaltribe` - the animal tribe the cart recruits as its draught animal. */
  draggingAnimalTribe: TypeId.optional(),
  /** `logictransformvehicleType` - the type the vehicle becomes once the animal arrives (6 -> 2). */
  transformVehicleType: TypeId.optional(),
  /** The vehicle's full hit-point pool. Not an `.ini` key: the engine indexes a code table by type
   *  (ships 5000, catapult 3000, everything else the default; byte-verified, docs/formats/VEHICLES.md). */
  hitpoints: z.number().int().positive().default(1000),
  source: Provenance.optional(),
});
export type VehicleType = z.infer<typeof VehicleType>;
