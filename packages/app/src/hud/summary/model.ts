import type { HudModel } from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import {
  JOB_BABY_FEMALE,
  JOB_BABY_MALE,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  SOLDIER_JOB_MAX,
  SOLDIER_JOB_MIN,
} from '../../catalog/jobs.js';

/**
 * The top-right summary's figures, read off the per-tick {@link HudModel}: the seat's people split by
 * sex and age, its stock folded into five categories, and the session clock. Membership and scope are
 * the model's: `Owner.player` across the whole map, every store the seat owns.
 */

export type SummaryCategoryId = 'food' | 'materials' | 'armament' | 'equipment' | 'other';

export interface SummaryCategorySpec {
  readonly id: SummaryCategoryId;
  /** The good whose icon stands for the category on the bar. */
  readonly icon: string;
  /** The goods the breakdown lists, in reading order, one array per column. A listed good with
   *  nothing on hand still shows, as a zero. */
  readonly columns: readonly (readonly string[])[];
}

/**
 * The five categories and their rows, as the user grouped them for the approved design. A named
 * approximation keyed by the goods' stable string ids: no such grouping exists in `goodtypes.ini`.
 * A stocked good outside every list joins "other", so nothing on hand goes unreported.
 */
export const SUMMARY_CATEGORIES: readonly SummaryCategorySpec[] = [
  { id: 'food', icon: 'food_simple', columns: [['wheat', 'flour', 'food_simple', 'candy', 'mead']] },
  {
    id: 'materials',
    icon: 'wood',
    columns: [
      ['wood', 'stone', 'mud', 'iron', 'gold', 'mushroom', 'leather', 'wool'],
      ['brick', 'tile', 'pillar', 'ornament', 'holy_oil'],
    ],
  },
  {
    id: 'armament',
    icon: 'sword_shord',
    columns: [
      ['sword_shord', 'sword_long', 'bow_short', 'bow_long', 'spear_wooden', 'spear_iron'],
      ['armor_wool', 'armor_leather', 'armor_chain', 'armor_plate'],
    ],
  },
  {
    id: 'equipment',
    icon: 'shoes',
    columns: [['shoes', 'tool_wooden', 'tool_iron', 'crockery', 'furniture']],
  },
  {
    id: 'other',
    icon: 'amulet_strength',
    columns: [
      [
        'herb',
        'potion_food_small',
        'potion_food_big',
        'potion_stamina_small',
        'potion_stamina_big',
        'potion_heal_small',
        'potion_heal_big',
      ],
      [
        'coin',
        'amulet_food',
        'amulet_stamina',
        'amulet_strength',
        'amulet_defense',
        'amulet_crithit',
        'amulet_speed',
      ],
    ],
  },
];

/** The category an unlisted good falls into. */
const UNLISTED_CATEGORY: SummaryCategoryId = 'other';
/** Stocked goods the bar never reports: water is a well's working stock, not a resource on hand. */
const HIDDEN_GOODS: ReadonlySet<string> = new Set(['water']);
const LISTED_GOODS: ReadonlySet<string> = new Set(SUMMARY_CATEGORIES.flatMap((c) => c.columns.flat()));

export interface SummaryPopulation {
  /** Grown people with and without the sim's `Female` marker; a woman in a trade is still a woman. */
  readonly women: number;
  readonly men: number;
  /** The men in a soldier or hero job; `workers` is every other man, idle ones included. */
  readonly soldiers: number;
  readonly workers: number;
  /** Everyone not yet grown, baby or child, split by sex; disjoint from the adults. */
  readonly children: number;
  readonly girls: number;
  readonly boys: number;
  readonly total: number;
}

const GIRL_JOBS: ReadonlySet<number> = new Set([JOB_BABY_FEMALE, JOB_CHILD_FEMALE]);
const BOY_JOBS: ReadonlySet<number> = new Set([JOB_BABY_MALE, JOB_CHILD_MALE]);

/** The `jobtypes.ini` soldier band and the named heroes: the people the original lists under its army. */
const isMilitaryJob = (jobType: number): boolean =>
  (jobType >= SOLDIER_JOB_MIN && jobType <= SOLDIER_JOB_MAX) ||
  (jobType >= JOB_HERO_UNARMED && jobType <= JOB_HEROINE_BOW);

export function summaryPopulation(model: HudModel): SummaryPopulation {
  let women = 0;
  let men = 0;
  let soldiers = 0;
  let girls = 0;
  let boys = 0;
  for (const { jobType, count, female } of model.jobs) {
    if (GIRL_JOBS.has(jobType)) girls += count;
    else if (BOY_JOBS.has(jobType)) boys += count;
    else {
      women += female;
      men += count - female;
      if (isMilitaryJob(jobType)) soldiers += count - female;
    }
  }
  return {
    women,
    men,
    soldiers,
    workers: men - soldiers,
    children: girls + boys,
    girls,
    boys,
    total: model.population,
  };
}

export interface SummaryRow {
  readonly goodId: string;
  readonly amount: number;
}

export interface SummaryCategory {
  readonly id: SummaryCategoryId;
  /** The sum of every row, listed or not. */
  readonly total: number;
  readonly columns: readonly (readonly SummaryRow[])[];
}

/**
 * The seat's stock by category, in the fixed row order. `goodIdOf` names a stock entry's good; an
 * entry it cannot name is not a good the catalog knows and is left out, as is a {@link HIDDEN_GOODS}
 * entry. Unlisted goods with stock are appended to the shorter column of {@link UNLISTED_CATEGORY}
 * (the first on a tie), in the model's ascending-id order.
 */
export function summaryStocks(
  model: HudModel,
  goodIdOf: (goodType: number) => string | undefined,
): readonly SummaryCategory[] {
  const amounts = new Map<string, number>();
  for (const { goodType, amount } of model.stocks) {
    const goodId = goodIdOf(goodType);
    if (goodId !== undefined) amounts.set(goodId, (amounts.get(goodId) ?? 0) + amount);
  }
  const unlisted: SummaryRow[] = [...amounts]
    .filter(([goodId, amount]) => !LISTED_GOODS.has(goodId) && !HIDDEN_GOODS.has(goodId) && amount > 0)
    .map(([goodId, amount]) => ({ goodId, amount }));

  return SUMMARY_CATEGORIES.map((category) => {
    const columns = category.columns.map((column) =>
      column.map((goodId) => ({ goodId, amount: amounts.get(goodId) ?? 0 })),
    );
    if (category.id === UNLISTED_CATEGORY && unlisted.length > 0) {
      const shortest = columns.reduce((best, column) => (column.length < best.length ? column : best));
      shortest.push(...unlisted);
    }
    const total = columns.flat().reduce((sum, row) => sum + row.amount, 0);
    return { id: category.id, total, columns };
  });
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Elapsed simulation time of a tick count as `h:mm:ss`, hours always shown so the bar never
 *  re-flows at the first hour. Ticks are the session's, so a save, a load, a speed change and a pause
 *  all read back as the sim advanced. */
export function formatSimClock(tick: number): string {
  const totalSeconds = Math.floor(tick / TICKS_PER_SECOND);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
