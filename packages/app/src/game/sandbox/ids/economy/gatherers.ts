import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import { JOB_COLLECTOR } from '../../../../catalog/jobs.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../../../../catalog/mining.js';
import { GOOD_GOLD, GOOD_IRON, GOOD_MUD, GOOD_MUSHROOM, GOOD_STONE, GOOD_WOOD } from './goods.js';

/** How a good leaves the landscape; only `mine` draws down a finite deposit. */
export type GatherMode = 'fell' | 'mine' | 'pick';

export interface GathererSpec {
  readonly good: number;
  readonly id: string;
  /** Always the collector: the original gives that one trade every harvest. */
  readonly job: number;
  readonly atomic: number;
  readonly animation: string;
  readonly mode: GatherMode;
  /** The frame of the clip's work event, extracted from its `atomicanimations.ini` row. */
  readonly workEventFrame: number;
  readonly nodes: number;
  readonly depositUnits?: number;
  readonly depositLevels?: number;
}

export const GATHERERS: readonly GathererSpec[] = [
  {
    good: GOOD_WOOD,
    id: 'wood',
    job: JOB_COLLECTOR,
    atomic: HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_tree',
    mode: 'fell',
    workEventFrame: 20,
    nodes: 2,
  },
  {
    good: GOOD_STONE,
    id: 'stone',
    job: JOB_COLLECTOR,
    atomic: STONE_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_stone',
    mode: 'mine',
    workEventFrame: 20,
    nodes: 1,
    depositUnits: STONE_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_MUD,
    id: 'mud',
    job: JOB_COLLECTOR,
    atomic: CLAY_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mud',
    mode: 'mine',
    workEventFrame: 20,
    nodes: 1,
    depositUnits: CLAY_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_IRON,
    id: 'iron',
    job: JOB_COLLECTOR,
    atomic: IRON_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_iron',
    mode: 'mine',
    workEventFrame: 19,
    nodes: 1,
    depositUnits: IRON_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_GOLD,
    id: 'gold',
    job: JOB_COLLECTOR,
    atomic: GOLD_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_gold',
    mode: 'mine',
    workEventFrame: 19,
    nodes: 1,
    depositUnits: GOLD_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_MUSHROOM,
    id: 'mushroom',
    job: JOB_COLLECTOR,
    atomic: MUSHROOM_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mushroom',
    mode: 'pick',
    workEventFrame: 21,
    nodes: 3,
  },
] as const;
