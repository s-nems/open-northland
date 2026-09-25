import { TICKS_PER_SECOND } from '../../core/loop.js';

const SECONDS_PER_MINUTE = 60;

/** Game minutes to sim ticks. */
export function minutesToTicks(minutes: number): number {
  return minutes * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
}

/**
 * The seat's game-time phases (authored, in game minutes): the opening saves every civilian, the mid game
 * from one hour hoards building goods, the late game from ninety minutes affords nice-to-have posts.
 * Game time runs about three times faster than the clock at the usual game speed, so the phases are
 * short in real minutes.
 */
export const MID_GAME_FROM_TICKS = minutesToTicks(60);
export const LATE_GAME_FROM_TICKS = minutesToTicks(90);

/** From when a core workshop (farm, mill, pottery, mason hut) never rests its first craftsman, whatever
 *  its products' stock (authored): a resting farm loses its sown fields and the miller his experience. */
export const CORE_CREW_FROM_TICKS = minutesToTicks(30);

/** From when the headquarters and the warehouses run transport carriers (authored): the deep late game,
 *  when the mints and druid huts stand and a carrier no longer costs a craftsman. */
export const STORE_CARRIERS_FROM_TICKS = minutesToTicks(120);

export type GamePhase = 'opening' | 'mid' | 'late';

export function gamePhase(tick: number): GamePhase {
  if (tick >= LATE_GAME_FROM_TICKS) return 'late';
  if (tick >= MID_GAME_FROM_TICKS) return 'mid';
  return 'opening';
}

/** How many lookahead units past the comfort line a managed good's glut line lies per phase (authored):
 *  the further into the game, the more building goods a seat hoards, since a gatherer costs it a smaller
 *  share of its men and every felled tree or quarried rock clears room to build on. */
export const HOARD_UNITS_BY_PHASE: Readonly<Record<GamePhase, number>> = {
  opening: 1,
  mid: 2,
  late: 3,
};
