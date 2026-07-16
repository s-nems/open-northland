import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import {
  CLAY_DEPOSIT_UNITS,
  CLAY_MINE_STRIKES_PER_UNIT,
  GOLD_DEPOSIT_UNITS,
  HARD_MINE_STRIKES_PER_UNIT,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../../../../catalog/mining.js';
import { GOOD_GOLD, GOOD_IRON, GOOD_MUD, GOOD_MUSHROOM, GOOD_STONE, GOOD_WOOD } from './goods.js';
import { JOB_COLLECTOR } from './jobs.js';

/** How a good leaves the landscape: chop a tree down, dig a finite deposit, or pluck a small node. */
export type GatherMode = 'fell' | 'mine' | 'pick';

export interface GathererSpec {
  readonly good: number;
  readonly id: string;
  /** The gatherer trade — always {@link JOB_COLLECTOR}: the original's one collector does every harvest. */
  readonly job: number;
  readonly atomic: number;
  readonly animation: string;
  readonly mode: GatherMode;
  readonly nodes: number;
  readonly depositUnits?: number;
  readonly depositLevels?: number;
  readonly strikesPerUnit?: number;
}

/** One row per gatherable good: its job, harvest atomic + clip, and how its nodes deplete. */
export const GATHERERS: readonly GathererSpec[] = [
  {
    good: GOOD_WOOD,
    id: 'wood',
    job: JOB_COLLECTOR,
    atomic: HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_tree',
    mode: 'fell',
    nodes: 2,
  },
  {
    good: GOOD_STONE,
    id: 'stone',
    job: JOB_COLLECTOR,
    atomic: STONE_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_stone',
    mode: 'mine',
    nodes: 1,
    depositUnits: STONE_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
    strikesPerUnit: HARD_MINE_STRIKES_PER_UNIT,
  },
  {
    good: GOOD_MUD,
    id: 'mud',
    job: JOB_COLLECTOR,
    atomic: CLAY_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mud',
    mode: 'mine',
    nodes: 1,
    depositUnits: CLAY_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
    strikesPerUnit: CLAY_MINE_STRIKES_PER_UNIT,
  },
  {
    good: GOOD_IRON,
    id: 'iron',
    job: JOB_COLLECTOR,
    atomic: IRON_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_iron',
    mode: 'mine',
    nodes: 1,
    depositUnits: IRON_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
    strikesPerUnit: HARD_MINE_STRIKES_PER_UNIT,
  },
  {
    good: GOOD_GOLD,
    id: 'gold',
    job: JOB_COLLECTOR,
    atomic: GOLD_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_gold',
    mode: 'mine',
    nodes: 1,
    depositUnits: GOLD_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
    strikesPerUnit: HARD_MINE_STRIKES_PER_UNIT,
  },
  {
    good: GOOD_MUSHROOM,
    id: 'mushroom',
    job: JOB_COLLECTOR,
    atomic: MUSHROOM_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mushroom',
    mode: 'pick',
    nodes: 3,
  },
] as const;
