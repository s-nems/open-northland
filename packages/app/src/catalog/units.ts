/**
 * Settler balance the readable data does not carry, read by both content bases so an adult settler has
 * the same hitpoints on either.
 */

/**
 * A settler's hitpoint pool (`TribeType.hitpoints`), an approximation on the real data scale (source
 * basis "Combat hit resolution"): animal `hitpointsAdult` runs to about 15000-20000, the HQ 100000, and
 * a real sword hits 1600, so at 5000 a fighter takes about 3 sword swings.
 */
export const HUMAN_HITPOINTS = 5000;
