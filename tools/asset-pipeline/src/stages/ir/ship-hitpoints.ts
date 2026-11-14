import type { VehicleType } from '@open-northland/data';
import { VEHICLE_TYPE_CODES } from '@open-northland/formats/ini';

const SHIPS: ReadonlySet<number> = new Set([
  VEHICLE_TYPE_CODES.VEHICLE_TYPE_SHIP_SMALL,
  VEHICLE_TYPE_CODES.VEHICLE_TYPE_SHIP_BIG,
]);

/** Owner's choice: both ships take 10000 hit points where the original's table gives 5000, so a deck of
 *  bowmen or a shore of them does not sink one in seconds. */
export const SHIP_HITPOINTS = 10_000;

export function withShipHitpoints(vehicle: VehicleType): VehicleType {
  return SHIPS.has(vehicle.typeId) ? { ...vehicle, hitpoints: SHIP_HITPOINTS } : vehicle;
}
