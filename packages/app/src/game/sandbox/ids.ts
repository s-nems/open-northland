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
// Deliberately OUTSIDE the real soldier band (31..41) so the job→body map draws the civilian body — the
// previous 36 was the real `soldier_saber_short`, so the carrier drew an armoured swordsman. 26 is the
// real `jobtypes.ini` `trader_sea`, borrowed here only because it isn't in `ADULT_CHARACTER_BY_JOB` (so
// it falls to the civilian body); the REAL carrier id (type 24) is taken by the synthetic gatherer band
// (20..25) above. Renumbering the sandbox id space onto the real trade/carrier ids is its own cleanup.
export const JOB_CARRIER = 26;
// Soldier jobs ride the REAL viking `jobtypes.ini` ids (soldiers 31..41) so the render's job→body map
// (`ADULT_CHARACTER_BY_JOB`) draws each class's own warrior body + weapon animation set.
// `JOB_SOLDIER` is the base, UNARMED soldier (`jobtypes.ini` type 31 `soldier_unarmed`): the single
// profession the picker offers. A soldier's weapon (a later step) specializes it into a spear/sword/bow
// class — only a soldier carries a weapon, so the base soldier stands unarmed until armed.
export const JOB_SOLDIER = 31; // soldier_unarmed — the one player-selectable soldier profession
export const JOB_SOLDIER_SPEAR = 33; // soldier_spear_iron
export const JOB_SOLDIER_SWORD = 34; // soldier_sword_short
export const JOB_SOLDIER_BROADSWORD = 35; // soldier_sword_long
export const JOB_ARCHER = 40; // soldier_bow_short
export const JOB_ARCHER_LONG = 41; // soldier_bow_long

/**
 * Base offset the extracted building worker-slot job ids are lifted by so they clear the sandbox's own
 * job band (idle 0, gatherers 20..25, carrier 26, soldiers 31..41, the picker professions — all < 1000).
 * A rebased slot job is `BASE + originalId`; the carrier keeps its own {@link JOB_CARRIER} id. See
 * `content.ts` {@link import('./content.js')} BUILDING_WORKER_SLOTS for why the rebase is needed (the
 * original `logicworker` ids overlap the bands above).
 */
export const WORKER_SLOT_JOB_BASE = 1000;

/**
 * The extracted worker-slot trades that are OUTDOOR RESOURCE GATHERERS (`jobtypes.ini`: 8 collector,
 * 15 hunter, 22 fisher, 23 fisher_sea), keyed by their ORIGINAL id. A gatherer roams the map collecting
 * a raw good and drops it at a flag — so, like the sandbox's own gatherers, it is NEVER hand-assigned to
 * a building by right-click and draws the gatherer badge colour (it happens to sit in a storehouse's or
 * workshop's `logicworker` pool, but that is the economy's to fill, not the player's). Source basis:
 * the `jobtypes` roles in `content/ir.json`.
 */
export const EXTRACTED_GATHERER_TRADES: ReadonlySet<number> = new Set([8, 15, 22, 23]);

/** Rebase one extracted slot job clear of the sandbox band ({@link WORKER_SLOT_JOB_BASE}) — the carrier
 *  keeps its own {@link JOB_CARRIER} id (the hauler the badge/assignment UI single out). */
export function rebaseSlotJob(jobType: number): number {
  return jobType === JOB_CARRIER ? JOB_CARRIER : WORKER_SLOT_JOB_BASE + jobType;
}

export const BUILDING_HEADQUARTERS = 1;
/** The three warehouse levels (`stock_00`/`stock_01`/`stock_02`) — general-goods stores like the HQ. */
export const BUILDING_WAREHOUSE_00 = 7;
export const BUILDING_WAREHOUSE_01 = 8;
export const BUILDING_WAREHOUSE_02 = 9;
export const BUILDING_JOINERY = 23;

// Weapon typeIds ride the REAL viking `weapons.ini` ids (iron_spear 5, short_sword 7, long_sword 8,
// short_bow 16, long_bow 17) — the previous synthetic 20/21 bows collided with the real house_bow (20)
// and catapult (21), a scoped-id trap for anyone joining these against extracted data.
export const WEAPON_SPEAR = 5;
export const WEAPON_SWORD = 7;
export const WEAPON_BROADSWORD = 8;
export const WEAPON_SHORT_BOW = 16;
export const WEAPON_LONG_BOW = 17;

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
