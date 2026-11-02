import type { VehicleType } from '@open-northland/data';
import { VEHICLE_JOB_ID_OFFSET, VEHICLE_TYPE_CODES } from '@open-northland/formats/ini';

const BIG_SHIP = VEHICLE_TYPE_CODES.VEHICLE_TYPE_SHIP_BIG;
const CART_SLOTS = 1;
const CART_JOBS = [
  VEHICLE_TYPE_CODES.VEHICLE_TYPE_CART_HAND + VEHICLE_JOB_ID_OFFSET,
  VEHICLE_TYPE_CODES.VEHICLE_TYPE_CART_OX + VEHICLE_JOB_ID_OFFSET,
];

/** Owner's choice: the big ship carries one cart, hand or ox, and no catapult, where the original's
 *  `vehicletypes.ini` gives it no vehicle slot; a trader's cart crosses the sea this way. */
export function withBigShipCartSlot(vehicle: VehicleType): VehicleType {
  if (vehicle.typeId !== BIG_SHIP) return vehicle;
  const added = CART_JOBS.filter((job) => !vehicle.passengerJobs.includes(job));
  return {
    ...vehicle,
    vehicleSlots: CART_SLOTS,
    passengerJobs: [...vehicle.passengerJobs, ...added],
  };
}
