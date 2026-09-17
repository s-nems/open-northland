/** The `vehicletypes.ini` `type` ids, shared by the sandbox catalog and the decoded content. */
export const VEHICLE_HANDCART = 1;
export const VEHICLE_OXCART = 2;
export const VEHICLE_SHIP_SMALL = 3;
export const VEHICLE_SHIP_BIG = 4;
export const VEHICLE_CATAPULT = 5;
/** The ox cart before its animal arrives (`logicdefines.inc` `cart_no_ox`). */
export const VEHICLE_CART_NO_OX = 6;

/** A vehicle's own job id, `JOB_TYPE_VEHICLE_* = type + 49` (`logicdefines.inc`): the key its animation
 *  table and its weapon row bind by, and the id a ship's passenger list names a carried vehicle by. */
export const VEHICLE_JOB_OFFSET = 49;
/** The catapult's job: `weapons.ini` binds the siege weapon to it. */
export const JOB_VEHICLE_CATAPULT = VEHICLE_CATAPULT + VEHICLE_JOB_OFFSET;
