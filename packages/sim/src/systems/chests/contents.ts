import type { ContentSet } from '@open-northland/data';
import type { ChestKind, Paper, PaperKind } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';

/**
 * What a chest type hands out when opened. `count` for goods is per chest kind, a magical chest holding
 * more of the same. Content is named by catalog slug, resolved against the running content set so the
 * sandbox catalog and real content both work; a slug the content lacks hands out nothing.
 */
export type ChestReward =
  | { readonly kind: 'goods'; readonly good: string; readonly count: Readonly<Record<ChestKind, number>> }
  | { readonly kind: 'paper'; readonly paper: PaperKind; readonly house?: string }
  /** A stocked-house paper, its Viking worker, and the production permanently enabled with it. */
  | {
      readonly kind: 'workshop';
      readonly house: string;
      readonly worker: string;
      readonly goods: readonly string[];
    }
  | { readonly kind: 'settlers'; readonly job: string; readonly tribe: string; readonly count: number }
  | { readonly kind: 'animals'; readonly tribe: string; readonly count: number }
  /** The original spawns a catapult; the sim has no land vehicles, so this opens empty. */
  | { readonly kind: 'vehicle' };

const SINGLE = { wooden: 1, magical: 3 } as const;
const POTIONS = { wooden: 12, magical: 18 } as const;
const WEAR = { wooden: 6, magical: 9 } as const;
const SPAWNED_SETTLERS = 3;

function goods(good: string, count: Readonly<Record<ChestKind, number>>): ChestReward {
  return { kind: 'goods', good, count };
}
function house(house: string): ChestReward {
  return { kind: 'paper', paper: 'placeHouse', house };
}
function workshop(house: string, worker: string, goods: readonly string[]): ChestReward {
  return { kind: 'workshop', house, worker, goods };
}
function settlers(job: string): ChestReward {
  return { kind: 'settlers', job, tribe: 'viking', count: SPAWNED_SETTLERS };
}

/**
 * The chest-type table, keyed by the type a map authors on a chest placement. Source basis: the
 * original's chest-use dispatch (byte evidence), whose row keys and reward kinds the readable
 * `chesttypes` string table corroborates; the exact ids and counts are the dispatch's own and unconfirmed by
 * observation. Ids are written as their catalog slugs.
 */
export const CHEST_CONTENTS: ReadonlyMap<number, ChestReward> = new Map<number, ChestReward>([
  [1, goods('potion_food_small', SINGLE)],
  [2, goods('potion_food_big', SINGLE)],
  [3, goods('potion_stamina_small', SINGLE)],
  [4, goods('potion_stamina_big', SINGLE)],
  [5, goods('potion_heal_small', SINGLE)],
  [6, goods('potion_heal_big', SINGLE)],
  [7, goods('amulet_food', SINGLE)],
  [8, goods('amulet_stamina', SINGLE)],
  [9, goods('amulet_strength', SINGLE)],
  [10, goods('amulet_defense', SINGLE)],
  [11, goods('amulet_crithit', SINGLE)],
  [12, goods('amulet_speed', SINGLE)],
  [20, goods('food_simple', { wooden: 30, magical: 48 })],
  [21, goods('potion_food_big', POTIONS)],
  [22, goods('potion_stamina_big', POTIONS)],
  [23, goods('potion_heal_big', POTIONS)],
  [24, goods('armor_chain', WEAR)],
  [25, goods('armor_plate', WEAR)],
  [26, goods('shoes', WEAR)],
  // The `chesttypes` string table names row 50 an indulgence; the dispatch hands out a place-any paper.
  [50, { kind: 'paper', paper: 'placeAny' }],
  [51, { kind: 'paper', paper: 'placeAny' }],
  [52, house('tower_01')],
  [53, house('work_temple')],
  [54, house('barracks')],
  [55, house('stock_02')],
  [56, house('home_level_01')],
  [57, house('home_level_04')],
  [60, house('work_well_00')],
  [61, house('work_farm_00')],
  [62, house('work_mill_00')],
  [63, house('work_bakery_00')],
  [64, house('headquarters')],
  [65, house('school')],
  [70, workshop('work_smithy_01', 'smith', ['sword_long'])],
  [71, workshop('work_druid_00', 'druid', ['holy_oil'])],
  [72, workshop('work_coin_mint', 'coin_maker', ['coin'])],
  [
    73,
    workshop('work_druid_01', 'druid', [
      'holy_oil',
      'potion_food_small',
      'potion_stamina_small',
      'potion_heal_small',
    ]),
  ],
  [74, workshop('work_armory_00', 'armorer', ['bow_short'])],
  [90, { kind: 'animals', tribe: 'wolves', count: 5 }],
  [91, { kind: 'vehicle' }],
  [92, settlers('civilist')],
  [93, settlers('woman')],
  [94, settlers('soldier_sword_long')],
  [95, settlers('soldier_bow_long')],
  [96, { kind: 'animals', tribe: 'lions', count: 3 }],
]);

/** A chest reward with its slugs resolved to the running content's type ids. */
export type ResolvedChestReward =
  | { readonly kind: 'goods'; readonly goodType: number; readonly amount: number }
  | { readonly kind: 'paper'; readonly paper: Paper }
  | {
      readonly kind: 'workshop';
      readonly paper: Paper;
      readonly tribe: number;
      readonly jobType: number;
      readonly goodTypes: readonly number[];
    }
  | { readonly kind: 'settlers'; readonly tribe: number; readonly jobType: number; readonly count: number }
  | { readonly kind: 'animals'; readonly tribe: number; readonly count: number }
  | { readonly kind: 'nothing' };

const NOTHING: ResolvedChestReward = { kind: 'nothing' };

/** The reward chest type `contents` in a `kind` chest hands out on this content, or `nothing`. */
export function resolveChestReward(
  content: ContentSet,
  kind: ChestKind,
  contents: number,
): ResolvedChestReward {
  const reward = CHEST_CONTENTS.get(contents);
  if (reward === undefined) return NOTHING;
  const index = contentIndex(content);
  switch (reward.kind) {
    case 'goods': {
      const goodType = index.goodTypeBySlug.get(reward.good);
      return goodType === undefined ? NOTHING : { kind: 'goods', goodType, amount: reward.count[kind] };
    }
    case 'paper': {
      if (reward.house === undefined) return { kind: 'paper', paper: { kind: reward.paper, param: 0 } };
      const param = index.buildingTypeBySlug.get(reward.house);
      return param === undefined ? NOTHING : { kind: 'paper', paper: { kind: reward.paper, param } };
    }
    case 'workshop': {
      const param = index.buildingTypeBySlug.get(reward.house);
      const jobType = index.jobTypeBySlug.get(reward.worker);
      const tribe = index.tribeTypeBySlug.get('viking');
      const goodTypes: number[] = [];
      for (const id of reward.goods) {
        const goodType = index.goodTypeBySlug.get(id);
        if (goodType === undefined) return NOTHING;
        goodTypes.push(goodType);
      }
      if (param === undefined || jobType === undefined || tribe === undefined) return NOTHING;
      return {
        kind: 'workshop',
        paper: { kind: 'placeStockedHouse', param },
        tribe,
        jobType,
        goodTypes,
      };
    }
    case 'settlers': {
      const jobType = index.jobTypeBySlug.get(reward.job);
      const tribe = index.tribeTypeBySlug.get(reward.tribe);
      return jobType === undefined || tribe === undefined
        ? NOTHING
        : { kind: 'settlers', tribe, jobType, count: reward.count };
    }
    case 'animals': {
      const tribe = index.tribeTypeBySlug.get(reward.tribe);
      if (tribe === undefined || !index.animalsByTribe.has(tribe)) return NOTHING;
      return { kind: 'animals', tribe, count: reward.count };
    }
    case 'vehicle':
      return NOTHING;
  }
}
