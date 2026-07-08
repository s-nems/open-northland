import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../../catalog/mining.js';

/**
 * The sandbox content's semantic type ids — goods, jobs, buildings, weapons — plus the per-good
 * {@link GATHERERS} table that drives the gathering half of the content, the placement helpers and the
 * scene checks. The ids are the ONE place a sandbox `typeId` gets a name; everything else refers to
 * these constants, never a bare number (repo no-magic-numbers rule).
 */

export const GOOD_NONE = 0;
export const GOOD_WOOD = 1;
export const GOOD_PLANK = 2;
export const GOOD_COIN = 3;
export const GOOD_STONE = 4;
export const GOOD_MUD = 5;
export const GOOD_IRON = 6;
export const GOOD_GOLD = 7;
export const GOOD_MUSHROOM = 8;

export const JOB_IDLE = 0;
export const JOB_GATHERER_WOOD = 20;
export const JOB_GATHERER_STONE = 21;
export const JOB_GATHERER_MUD = 22;
export const JOB_GATHERER_IRON = 23;
export const JOB_GATHERER_GOLD = 24;
export const JOB_GATHERER_MUSHROOM = 25;
export const JOB_CARRIER = 36;
export const JOB_SOLDIER_SWORD = 34;
export const JOB_ARCHER = 40;

export const BUILDING_HEADQUARTERS = 1;
export const BUILDING_JOINERY = 23;

export const WEAPON_SWORD = 7;
export const WEAPON_SHORT_BOW = 20;
export const WEAPON_LONG_BOW = 21;

/** How a good leaves the landscape: chop a tree down, dig a finite deposit, or pluck a small node. */
export type GatherMode = 'fell' | 'mine' | 'pick';

export interface GathererSpec {
  readonly good: number;
  readonly id: string;
  readonly job: number;
  readonly label: string;
  readonly atomic: number;
  readonly animation: string;
  readonly mode: GatherMode;
  readonly nodes: number;
  readonly depositUnits?: number;
  readonly depositLevels?: number;
}

/** One row per gatherable good: its job, harvest atomic + clip, and how its nodes deplete. */
export const GATHERERS: readonly GathererSpec[] = [
  {
    good: GOOD_WOOD,
    id: 'wood',
    job: JOB_GATHERER_WOOD,
    label: 'Zbieracz (Drewno)',
    atomic: HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_tree',
    mode: 'fell',
    nodes: 2,
  },
  {
    good: GOOD_STONE,
    id: 'stone',
    job: JOB_GATHERER_STONE,
    label: 'Zbieracz (Kamien)',
    atomic: STONE_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_stone',
    mode: 'mine',
    nodes: 1,
    depositUnits: STONE_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_MUD,
    id: 'mud',
    job: JOB_GATHERER_MUD,
    label: 'Zbieracz (Glina)',
    atomic: CLAY_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mud',
    mode: 'mine',
    nodes: 1,
    depositUnits: CLAY_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_IRON,
    id: 'iron',
    job: JOB_GATHERER_IRON,
    label: 'Zbieracz (Zelazo)',
    atomic: IRON_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_iron',
    mode: 'mine',
    nodes: 1,
    depositUnits: IRON_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_GOLD,
    id: 'gold',
    job: JOB_GATHERER_GOLD,
    label: 'Zbieracz (Zloto)',
    atomic: GOLD_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_gold',
    mode: 'mine',
    nodes: 1,
    depositUnits: GOLD_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_MUSHROOM,
    id: 'mushroom',
    job: JOB_GATHERER_MUSHROOM,
    label: 'Zbieracz (Grzyby)',
    atomic: MUSHROOM_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mushroom',
    mode: 'pick',
    nodes: 3,
  },
] as const;
