import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { ComputerProfile } from '../difficulty.js';
import { LATE_GAME_FROM_TICKS, SITES_GROW_FROM_TICKS } from '../game-phase.js';
import type { BuildOrderEntry } from './entries.js';

/** The warehouse tiers a seat with no base puts up, best first: the headquarters declares an empty
 *  construction bill and would raise for free, so a warehouse takes the goods hub over instead. Owner
 *  ruling: the top tier, a lower one only while the seat cannot raise it (`./index.ts`). */
export const BASE_REPLACEMENT_IDS: readonly string[] = ['stock_02', 'stock_01', 'stock_00'];

/** The replacement's placement modifiers; `building` names the top tier and `count` is structural. */
export const BASE_REPLACEMENT_ENTRY: Extract<BuildOrderEntry, { kind: 'place' }> = {
  kind: 'place',
  building: 'stock_02',
  count: 1,
};

/** The opening's concurrent construction sites per seat, upgrade sites included (authored); the supply
 *  lines size their short line by it in every phase. */
export const MAX_ACTIVE_CONSTRUCTION_SITES = 2;

/** The store sites a seat that lost its base keeps open (authored): one, so the replacement warehouse is
 *  never placed twice while its first site still stands unbuilt. */
export const BASELESS_CONSTRUCTION_SITES = 1;

/** The opening's lookahead: how many steps of a line past its first one still waiting on a construction
 *  site the build order may act on (authored). A slow site holds its line back so the steps behind it
 *  never outrun the materials and inputs it brings; it is counted per line, since the lines feed nothing
 *  to each other in their own order and the site pace already bounds the sites all lines open at once. */
export const BUILD_ORDER_LOOKAHEAD_ENTRIES = 3;

/** How many sites a seat keeps open and how far past the oldest waiting one it looks, from `fromTick`. */
export interface SitePace {
  readonly fromTick: number;
  readonly sites: number;
  readonly lookahead: number;
}

/** The hard seat's pace by game clock (authored): the opening's two sites, a third with one more entry of
 *  lookahead from {@link SITES_GROW_FROM_TICKS}, a fourth with one more again from the late game, when the
 *  builder reserve grows to match (`workforce/staffing.ts`). */
export const SITE_PACE_STEPS: readonly SitePace[] = [
  { fromTick: 0, sites: MAX_ACTIVE_CONSTRUCTION_SITES, lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES },
  {
    fromTick: SITES_GROW_FROM_TICKS,
    sites: MAX_ACTIVE_CONSTRUCTION_SITES + 1,
    lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES + 1,
  },
  {
    fromTick: LATE_GAME_FROM_TICKS,
    sites: MAX_ACTIVE_CONSTRUCTION_SITES + 2,
    lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES + 2,
  },
];

/** The step of `profile`'s pace reached at `tick`. */
export function sitePace(profile: ComputerProfile, tick: number): SitePace {
  let pace = profile.sitePace[0];
  if (pace === undefined) throw new Error(`the ${profile.difficulty} site pace is empty`);
  for (const step of profile.sitePace) {
    if (tick >= step.fromTick) pace = step;
  }
  return pace;
}

/** How long a regressed entry, a razed building's, waits before the seat raises it again, counted from the
 *  last decision that saw the seat under attack (authored): long enough for a band that razed it to walk
 *  off, so the site is not flattened again as it rises. */
export const REBUILD_DELAY_TICKS = 30 * TICKS_PER_SECOND;

/** How far from the nearest of the seat's buildings a placement may land, in half-cell Manhattan nodes
 *  (authored): tight enough that the settlement grows as one piece. Every affinity pull stays inside it. */
export const BUILD_SEARCH_MAX_RADIUS_NODES = 32;

/** How many nodes of Manhattan distance from the base anchor cost a candidate spot one ring of distance
 *  from its search centre (authored): the affinity centre stays the main criterion and the base's
 *  closeness decides between spots about as near to it, so a settlement grows round rather than long. */
export const HQ_PULL_DIVISOR_NODES = 4;

/** How many times its usual reach a placement falls back to when nothing inside that reach takes the
 *  building (authored): a base boxed in by forest or rock builds past it rather than waiting for the
 *  gatherers to clear it. */
const OVERFLOW_REACH_FACTOR = 2;

/** The fallback reach, in the same nodes, of a seat whose usual placement reach is `reachNodes`. */
export function overflowBuildReachNodes(reachNodes: number): number {
  return OVERFLOW_REACH_FACTOR * reachNodes;
}

/** Decisions between the spot searches of an entry whose last search found nothing, a lane's and a
 *  passed-over entry's included, about 60 s at the decision interval. It never gives up, since felled
 *  trees or a razed building can free room later. Approximation: a tuned cadence, not an original value. */
export const STALLED_PLACEMENT_RETRY_DECISIONS = 15;
