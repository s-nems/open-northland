import type { VehicleType } from '@open-northland/data';
import {
  JOB_CARRIER,
  JOB_HEROINE_BOW,
  JOB_SOLDIER_UNARMED,
  JOB_TRADER,
  JOB_WOMAN,
} from '../../../../catalog/jobs.js';
import {
  GOOD_NONE,
  VEHICLE_CART_NO_OX,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_JOB_OFFSET,
  VEHICLE_OXCART,
  VEHICLE_SHIP_BIG,
  VEHICLE_SHIP_SMALL,
} from '../../ids/index.js';

/**
 * The six `vehicletypes.ini` records with their extracted slot, size, door and pool values
 * (docs/formats/VEHICLES.md), keyed on the sandbox's own good and job ids: every good but the sentinel
 * may ride in a hold, and the ships take every adult job while the carts take the two haulers and the
 * catapult the fighters; the script captain is the trader on a cart, the carrier on a ship and the
 * unarmed soldier on the catapult, as `logiccommander` authors them. `jobId` follows
 * `JOB_TYPE_VEHICLE_* = type + 49` (`logicdefines.inc`); the sandbox declares only the catapult's, for
 * its weapon row.
 */
export function buildSandboxVehicles(
  goods: readonly { readonly typeId: number }[],
  jobTypes: readonly number[],
): VehicleType[] {
  const cargoGoods = goods.map((g) => g.typeId).filter((id) => id !== GOOD_NONE);
  const adults = jobTypes.filter((job) => job >= JOB_WOMAN && job <= JOB_HEROINE_BOW);
  const fighters = jobTypes.filter((job) => job >= JOB_SOLDIER_UNARMED && job <= JOB_HEROINE_BOW);
  const haulers = jobTypes.filter((job) => job === JOB_TRADER || job === JOB_CARRIER);
  const jobOf = (typeId: number): number => typeId + VEHICLE_JOB_OFFSET;
  /** A cart with a crew list also names the trader as its script captain; the ox-less one has neither. */
  const cart = (typeId: number, id: string, stockSlots: number, crew: number[] | null): VehicleType => ({
    typeId,
    id,
    jobId: jobOf(typeId),
    stockSlots,
    passengerSlots: 0,
    logicSize: CART_SIZE,
    cargoGoods,
    passengerJobs: crew ?? [],
    ...(crew === null ? {} : { commanderJob: JOB_TRADER }),
    vehicleSlots: 0,
    hitpoints: CART_HITPOINTS,
  });
  const ship = (
    typeId: number,
    id: string,
    stockSlots: number,
    passengerSlots: number,
    vehicleSlots: number,
  ) =>
    ({
      typeId,
      id,
      jobId: jobOf(typeId),
      stockSlots,
      passengerSlots,
      logicSize: SHIP_SIZE,
      cargoGoods,
      // The ship rows also admit the vehicle jobs they carry, which is how a cart is loaded aboard.
      passengerJobs: [...adults, jobOf(VEHICLE_HANDCART), jobOf(VEHICLE_OXCART), jobOf(VEHICLE_CATAPULT)],
      commanderJob: JOB_CARRIER,
      vehicleSlots,
      passengerVector: SHIP_DOOR,
      hitpoints: SHIP_HITPOINTS,
    }) satisfies VehicleType;
  return [
    cart(VEHICLE_HANDCART, 'handcart', HANDCART_SLOTS, haulers),
    {
      ...cart(VEHICLE_CART_NO_OX, 'cart_no_ox', OXCART_SLOTS, null),
      transformVehicleType: VEHICLE_OXCART,
    },
    cart(VEHICLE_OXCART, 'oxcart', OXCART_SLOTS, haulers),
    ship(VEHICLE_SHIP_SMALL, 'ship_small', SHIP_SMALL_SLOTS, SHIP_SMALL_PASSENGERS, 1),
    ship(VEHICLE_SHIP_BIG, 'ship_big', SHIP_BIG_SLOTS, SHIP_BIG_PASSENGERS, 0),
    {
      typeId: VEHICLE_CATAPULT,
      id: 'catapult',
      jobId: jobOf(VEHICLE_CATAPULT),
      stockSlots: 0,
      passengerSlots: 0,
      logicSize: CATAPULT_SIZE,
      cargoGoods: [],
      passengerJobs: fighters,
      commanderJob: JOB_SOLDIER_UNARMED,
      vehicleSlots: 0,
      hitpoints: CATAPULT_HITPOINTS,
    },
  ];
}

/** `JOB_TYPE_VEHICLE_* = type + 49` (`logicdefines.inc`). */
const CART_SIZE = 0;
const CATAPULT_SIZE = 1;
const SHIP_SIZE = 2;
const HANDCART_SLOTS = 15;
const OXCART_SLOTS = 30;
const SHIP_SMALL_SLOTS = 50;
const SHIP_BIG_SLOTS = 200;
const SHIP_SMALL_PASSENGERS = 19;
const SHIP_BIG_PASSENGERS = 9;
/** `passengervector 2 4`: the door four steps off at facing offset 2. */
const SHIP_DOOR = { direction: 2, distance: 4 } as const;
const CART_HITPOINTS = 1000;
const SHIP_HITPOINTS = 5000;
const CATAPULT_HITPOINTS = 3000;
