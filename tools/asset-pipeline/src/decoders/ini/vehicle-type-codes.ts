import { GOOD_TYPE_CODES } from './good-type-codes.js';
import { HOUSE_TYPE_CODES } from './house-type-codes.js';

/** The `#define VEHICLE_TYPE_*` codes of `Data/GameSourceIncludes/logicdefines.inc`; the codes are the
 *  `VehicleType.typeId`s. */
export const VEHICLE_TYPE_CODES = {
  VEHICLE_TYPE_NONE: 0,
  VEHICLE_TYPE_CART_HAND: 1,
  VEHICLE_TYPE_CART_OX: 2,
  VEHICLE_TYPE_SHIP_SMALL: 3,
  VEHICLE_TYPE_SHIP_BIG: 4,
  VEHICLE_TYPE_CATAPULT: 5,
  VEHICLE_TYPE_CART_NO_OX: 6,
} as const satisfies Readonly<Record<string, number>>;

/**
 * The engine's hit-point table indexed by vehicle type (byte-verified, docs/formats/VEHICLES.md): both
 * ships 5000, the catapult 3000, every cart {@link VEHICLE_HITPOINTS_DEFAULT}.
 */
export const VEHICLE_HITPOINTS_DEFAULT = 1000;
export const VEHICLE_HITPOINTS_BY_TYPE: ReadonlyMap<number, number> = new Map([
  [VEHICLE_TYPE_CODES.VEHICLE_TYPE_SHIP_SMALL, 5000],
  [VEHICLE_TYPE_CODES.VEHICLE_TYPE_SHIP_BIG, 5000],
  [VEHICLE_TYPE_CODES.VEHICLE_TYPE_CATAPULT, 3000],
]);

/** `logicdefines.inc` places every `JOB_TYPE_VEHICLE_*` at its `VEHICLE_TYPE_*` plus this offset
 *  (`JOB_TYPE_VEHICLE_CART_HAND 50` .. `JOB_TYPE_VEHICLE_CART_NO_OX 55`). */
export const VEHICLE_JOB_ID_OFFSET = 49;

/** The `vehicletypes.ini` names the two `oxcart` records alike; the define name tells the second
 *  apart, so its slug comes from here instead of the name. */
export const VEHICLE_SLUG_BY_TYPE: ReadonlyMap<number, string> = new Map([
  [VEHICLE_TYPE_CODES.VEHICLE_TYPE_CART_NO_OX, 'cart_no_ox'],
]);

const GOOD_PREFIX = 'GOOD_TYPE_VEHICLE_';
const HOUSE_PREFIX = 'HOUSE_TYPE_VEHICLE_';

/**
 * The vehicle house each vehicle good opens, keyed by good `typeId`: the `GOOD_TYPE_VEHICLE_<X>` and
 * `HOUSE_TYPE_VEHICLE_<X>` defines pair by their shared suffix (`CART_HAND` .. `CATAPULT`). The
 * engine's own join of good 59..63 to house 42..46 is not byte-verified; this is the readable basis.
 */
export function vehicleHouseByGood(): ReadonlyMap<number, number> {
  const pairs = new Map<number, number>();
  for (const [goodCode, goodId] of Object.entries(GOOD_TYPE_CODES)) {
    if (!goodCode.startsWith(GOOD_PREFIX)) continue;
    const houseId = HOUSE_TYPE_CODES[`${HOUSE_PREFIX}${goodCode.slice(GOOD_PREFIX.length)}`];
    if (houseId !== undefined) pairs.set(goodId, houseId);
  }
  return pairs;
}
