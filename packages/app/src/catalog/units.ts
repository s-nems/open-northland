/**
 * Settler balance the readable data does not carry, read by both content bases so an adult settler has
 * the same hitpoints on either.
 */

/**
 * A settler's hitpoint pool (`TribeType.hitpoints`). Original behavior: the maximum is 5000 for
 * every job, including heroes. Its one exception is a Byzantine wooden-spearman special case, which is outside this shared pool.
 */
export const HUMAN_HITPOINTS = 5000;
