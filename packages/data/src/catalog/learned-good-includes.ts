/**
 * Goods a school lesson teaches along with the one it names, keyed by good slug. Project choice, not
 * the original's: a carpenter taught the trade ship also builds the plain ship, which the original
 * teaches as a separate lesson.
 */
export const LEARNED_GOOD_INCLUDES: ReadonlyMap<string, readonly string[]> = new Map([
  ['ship_big', ['ship_small']],
]);
