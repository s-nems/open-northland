import { TICKS_PER_SECOND } from '../../core/loop.js';

const SECONDS_PER_MINUTE = 60;

/** Game minutes to sim ticks. */
function minutesToTicks(minutes: number): number {
  return minutes * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
}

/**
 * The seat's game-time phases (authored, in game minutes): the opening saves every civilian, the mid game
 * from one hour hoards building goods, the late game from ninety minutes affords nice-to-have posts.
 * Game minutes are sim time: at the x3 game speed one real minute is three of them.
 */
export const MID_GAME_FROM_TICKS = minutesToTicks(60);
export const LATE_GAME_FROM_TICKS = minutesToTicks(90);

/** From when a core workshop (farm, mill, pottery, mason hut) never rests its first craftsman, whatever
 *  its products' stock (authored): a resting farm loses its sown fields and the miller his experience. */
export const CORE_CREW_FROM_TICKS = minutesToTicks(30);

/** From when the seat's construction goods grow their gatherer posts past the opening's two, by schedule
 *  and by shortage (authored): the homes and workshops the list has reached by then eat more wood than two
 *  woodcutters bring, while the opening cannot spare the men. */
export const BUILDING_GOODS_GROW_FROM_TICKS = minutesToTicks(30);

/** From when the build order opens a third construction site and looks one entry further ahead
 *  (authored; the late game adds a fourth, `build-order/entries.ts`): by then the reserve and the
 *  building goods carry more than the opening's two sites. */
export const SITES_GROW_FROM_TICKS = minutesToTicks(45);

/** From when the headquarters and the warehouses run transport carriers (authored): the deep late game,
 *  when the mints and druid huts stand and a carrier no longer costs a craftsman. */
export const STORE_CARRIERS_FROM_TICKS = minutesToTicks(120);

/** When the opening hunter goes back to the pool even while game remains near the base (authored): by
 *  the mid game the farms feed the seat and the man is worth more as a builder. */
export const OPENING_HUNT_UNTIL_TICKS = minutesToTicks(60);

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
