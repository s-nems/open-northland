import { type AiDifficulty, AiPlayer, aiPlayerEntity } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import {
  BUILD_ORDER_LOOKAHEAD_ENTRIES,
  type BuildOrderEntry,
  MAX_ACTIVE_CONSTRUCTION_SITES,
  SITE_PACE_STEPS,
  type SitePace,
} from './build-order/entries.js';
import {
  LATE_GAME_FROM_TICKS,
  MID_GAME_FROM_TICKS,
  minutesToTicks,
  SITES_GROW_FROM_TICKS,
} from './game-phase.js';
import { ARMY_CAP_SOLDIERS } from './military/plan.js';
import {
  AI_CATAPULT_CAP,
  AI_CATAPULT_RESUME,
  CRAFT_PLANS_BY_BUILDING_ID,
  CRAFT_PLANS_BY_JOINERY_ROLE,
  type CraftPlan,
  EASY_CRAFT_PLANS,
  type JoineryRolePlans,
  joineryRolePlans,
} from './workforce/craft.js';

/** A share as an integer fraction, so the sim never multiplies by a float. */
export interface Share {
  readonly num: number;
  readonly den: number;
}

/** `share` of `whole`, rounded down. */
export function shareOf(whole: number, share: Share): number {
  return Math.floor((whole * share.num) / share.den);
}

/**
 * Everything a difficulty changes about one computer seat (authored). The modules are the same at every
 * level: `hard` is the full strategy, the lower levels build slower, breed slower and stop earlier.
 */
export interface AiProfile {
  readonly difficulty: AiDifficulty;
  /** Open construction sites and build-order lookahead by game clock (`build-order/entries.ts`). */
  readonly sitePace: readonly SitePace[];
  /** The builder reserve in the opening, once the seat has grown, and from the late game on
   *  (`workforce/staffing.ts`). */
  readonly builders: { readonly opening: number; readonly grown: number; readonly late: number };
  /** The share of the seat's family slots that may carry a child at once, at least one; null books every
   *  housed wife. */
  readonly birthShare: Share | null;
  /** The most of a building, by stable content id, that a `place` or `upgrade` entry asks for: a higher
   *  count is cut to it, and an entry capped at zero is dropped. */
  readonly buildingCaps: Readonly<Record<string, number>>;
  /** Whether the late game's dense tower ring runs as a lane. */
  readonly denseTowerRing: boolean;
  /** The catapult fleet the joinery builds up to, and falls back to before it builds again; a cap of zero
   *  drops the catapult joinery from the build order. */
  readonly catapults: { readonly cap: number; readonly resume: number };
  readonly craftPlans: Readonly<Record<string, CraftPlan>>;
  readonly joineryRolePlans: JoineryRolePlans;
  /** Whether recruits may be armed with a class's weaker weapons too, not only its best. */
  readonly weakerWeapons: boolean;
  /** The army at which the barracks sends the whole band. With `draftToCap`, also the most fighters the
   *  seat drafts. `floorShare` is the part of the strongest enemy's army the seat keeps as its floor.
   *  No wave marches before `firstWaveFromTick`, nor before the seat's peace ends. */
  readonly army: {
    readonly cap: number;
    readonly draftToCap: boolean;
    readonly floorShare: Share;
    readonly firstWaveFromTick: number;
  };
}

/** How many builders a hard seat's pool keeps (authored), enough for the build order's opening sites at
 *  once. Claimed right after minimum staffing, so construction never starves, and before every top-up
 *  tier, so the surplus ladder distributes only what is beyond the reserve. */
export const BUILDER_CAP = 12;

/** A hard seat's reserve once it has grown (`LATE_GAME_CIVILIANS`, `workforce/staffing-plan.ts`)
 *  (authored). */
export const GROWN_SEAT_BUILDER_CAP = 14;

/** A hard seat's reserve from the late game on, whatever the head count (authored): the build order then
 *  keeps four sites open (`build-order/entries.ts`). */
export const LATE_GAME_BUILDER_CAP = 16;

const WHOLE: Share = { num: 1, den: 1 };
const HALF: Share = { num: 1, den: 2 };
const QUARTER: Share = { num: 1, den: 4 };
const EIGHTH: Share = { num: 1, den: 8 };
const THREE_QUARTERS: Share = { num: 3, den: 4 };

const HARD: AiProfile = {
  difficulty: 'hard',
  sitePace: SITE_PACE_STEPS,
  builders: { opening: BUILDER_CAP, grown: GROWN_SEAT_BUILDER_CAP, late: LATE_GAME_BUILDER_CAP },
  birthShare: null,
  buildingCaps: {},
  denseTowerRing: true,
  catapults: { cap: AI_CATAPULT_CAP, resume: AI_CATAPULT_RESUME },
  craftPlans: CRAFT_PLANS_BY_BUILDING_ID,
  joineryRolePlans: CRAFT_PLANS_BY_JOINERY_ROLE,
  weakerWeapons: false,
  army: { cap: ARMY_CAP_SOLDIERS, draftToCap: false, floorShare: WHOLE, firstWaveFromTick: 0 },
};

/** The one construction site of the easy seat in every phase, and of the medium one in its opening hour. */
const ONE_SITE = 1;

const MEDIUM_CATAPULT_CAP = 8;
const MEDIUM_CATAPULT_RESUME = 6;
const MEDIUM_FIRST_WAVE_FROM_TICKS = minutesToTicks(90);

const MEDIUM: AiProfile = {
  difficulty: 'medium',
  sitePace: [
    { fromTick: 0, sites: ONE_SITE, lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES },
    {
      fromTick: MID_GAME_FROM_TICKS,
      sites: MAX_ACTIVE_CONSTRUCTION_SITES,
      lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES + 1,
    },
    {
      fromTick: LATE_GAME_FROM_TICKS,
      sites: MAX_ACTIVE_CONSTRUCTION_SITES,
      lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES + 2,
    },
  ],
  builders: { opening: 6, grown: 8, late: 10 },
  birthShare: QUARTER,
  buildingCaps: {
    home_level_04: 8,
    work_smithy_01: 4,
    work_bakery_01: 4,
    work_brewery: 2,
    work_hive_00: 2,
    work_druid_01: 4,
    work_armory_01: 2,
    work_coin_mint: 2,
  },
  denseTowerRing: true,
  catapults: { cap: MEDIUM_CATAPULT_CAP, resume: MEDIUM_CATAPULT_RESUME },
  craftPlans: CRAFT_PLANS_BY_BUILDING_ID,
  joineryRolePlans: joineryRolePlans(MEDIUM_CATAPULT_CAP, MEDIUM_CATAPULT_RESUME),
  weakerWeapons: false,
  army: {
    cap: 100,
    draftToCap: true,
    floorShare: THREE_QUARTERS,
    firstWaveFromTick: MEDIUM_FIRST_WAVE_FROM_TICKS,
  },
};

const EASY_FIRST_WAVE_FROM_TICKS = minutesToTicks(120);

const EASY: AiProfile = {
  difficulty: 'easy',
  sitePace: [
    { fromTick: 0, sites: ONE_SITE, lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES },
    { fromTick: SITES_GROW_FROM_TICKS, sites: ONE_SITE, lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES + 1 },
    { fromTick: LATE_GAME_FROM_TICKS, sites: ONE_SITE, lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES + 2 },
  ],
  builders: { opening: 6, grown: 8, late: 8 },
  birthShare: EIGHTH,
  buildingCaps: {
    home_level_04: 5,
    work_smithy_01: 2,
    work_bakery_01: 2,
    work_brewery: 1,
    work_hive_00: 1,
    work_druid_01: 1,
    work_armory_01: 1,
    work_coin_mint: 1,
  },
  denseTowerRing: false,
  catapults: { cap: 0, resume: 0 },
  craftPlans: { ...CRAFT_PLANS_BY_BUILDING_ID, ...EASY_CRAFT_PLANS },
  joineryRolePlans: joineryRolePlans(0, 0),
  weakerWeapons: true,
  army: { cap: 60, draftToCap: true, floorShare: HALF, firstWaveFromTick: EASY_FIRST_WAVE_FROM_TICKS },
};

export const AI_PROFILES: Readonly<Record<AiDifficulty, AiProfile>> = {
  easy: EASY,
  medium: MEDIUM,
  hard: HARD,
};

/** The profile `player`'s seat plays by; a seat with no computer player reads as hard. */
export function aiProfileOf(world: World, player: number): AiProfile {
  const carrier = aiPlayerEntity(world, player);
  return AI_PROFILES[carrier === null ? 'hard' : world.get(carrier, AiPlayer).difficulty];
}

const trimmedOrders = new WeakMap<
  readonly BuildOrderEntry[],
  Map<AiDifficulty, readonly BuildOrderEntry[]>
>();

/** `order` as `profile` plays it: counts cut to its {@link AiProfile.buildingCaps}, and the catapult
 *  joinery and the dense tower ring dropped where it goes without them. The hard profile gets `order`
 *  itself, so the caches keyed on the list stay shared. */
export function profileBuildOrder(
  order: readonly BuildOrderEntry[],
  profile: AiProfile,
): readonly BuildOrderEntry[] {
  if (profile.difficulty === 'hard') return order;
  let byDifficulty = trimmedOrders.get(order);
  if (byDifficulty === undefined) {
    byDifficulty = new Map();
    trimmedOrders.set(order, byDifficulty);
  }
  let trimmed = byDifficulty.get(profile.difficulty);
  if (trimmed === undefined) {
    trimmed = order.flatMap((entry) => {
      const kept = trimEntry(entry, profile);
      return kept === null ? [] : [kept];
    });
    byDifficulty.set(profile.difficulty, trimmed);
  }
  return trimmed;
}

function trimEntry(entry: BuildOrderEntry, profile: AiProfile): BuildOrderEntry | null {
  switch (entry.kind) {
    case 'place': {
      if (entry.role === 'catapult' && profile.catapults.cap === 0) return null;
      return cappedCount(entry, profile.buildingCaps[entry.building]);
    }
    case 'upgrade':
      return cappedCount(entry, profile.buildingCaps[entry.building]);
    case 'towerCoverage':
      return entry.lane === true && !profile.denseTowerRing ? null : entry;
    case 'collector':
    case 'storeCoverage':
      return entry;
  }
}

function cappedCount<E extends { readonly count: number }>(entry: E, cap: number | undefined): E | null {
  if (cap === undefined || entry.count <= cap) return entry;
  return cap === 0 ? null : { ...entry, count: cap };
}
