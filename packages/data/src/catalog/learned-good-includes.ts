/**
 * Goods a school lesson teaches along with the one it names, keyed by good slug. Project choice, not
 * the original's: a carpenter taught either ship builds both, where the original teaches each ship as
 * a separate lesson.
 */
export const LEARNED_GOOD_INCLUDES: ReadonlyMap<string, readonly string[]> = new Map([
  ['ship_small', ['ship_big']],
  ['ship_big', ['ship_small']],
]);
