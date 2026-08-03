import type { JobEnables } from '@open-northland/data';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BREEDER,
  JOB_COLLECTOR,
  JOB_HUNTER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SWORD,
} from '../../../../catalog/jobs.js';
import {
  BUILDING_BAKERY,
  BUILDING_FARM,
  BUILDING_HOME_00,
  BUILDING_JOINERY,
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WAREHOUSE_02,
  BUILDING_WELL,
  GOOD_CATTLE,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_LEATHER,
  GOOD_MEAT,
  GOOD_MUSHROOM,
  GOOD_SHEEP,
  GOOD_STONE,
  GOOD_WOOD,
  rebaseSlotJob,
} from '../../ids/index.js';

/**
 * Each edge means a settler of `jobType` alive in the tribe unlocks `targetId`. Source basis: a faithful
 * subset of the extracted viking `tribetypes.ini jobEnables`, not its full 265-edge graph.
 */

/** Gated on the collector (`ir.json`: job 8 is in each one's enabling set); the HQ carries no edge, so it
 *  can bootstrap the first collector. */
const COLLECTOR_GATED_HOUSES: readonly number[] = [
  BUILDING_HOME_00,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WAREHOUSE_02,
  BUILDING_WELL,
  BUILDING_FARM,
  BUILDING_MILL,
  BUILDING_BAKERY,
  BUILDING_JOINERY,
];

/** The map-gathered goods gated on the collector (real ir.json `jobEnablesGood 8 <good>`). Gating a good gates
 *  its production recipe, not its harvest - inert in the sandbox (no recipe outputs these) but the faithful
 *  shape. The food-chain goods are left ungated here: water is ungated in ir.json too, but wheat/flour/bread
 *  are really gated on the farmer/miller/baker - an approximation, since the sandbox omits those enable-jobs. */
const COLLECTOR_GATED_GOODS: readonly number[] = [GOOD_WOOD, GOOD_STONE, GOOD_IRON, GOOD_GOLD, GOOD_MUSHROOM];

/** The husbandry chain's gates (real ir.json `jobEnablesGood`): the HUNTER unlocks the animal products
 *  (meat, leather), the BREEDER unlocks the fed-animal tokens. Wool carries no edge in ir.json (ungated),
 *  mirrored by its absence here - an animal farm without a live hunter feeds its stock but converts only
 *  wool, exactly what the real-content browser run does. Job ids follow what a live settler actually
 *  carries: the sandbox hunter exists BOTH as a raw picker profession and as a rebased house worker slot
 *  ({@link rebaseSlotJob}), so the gate names both ids; the breeder exists only as the rebased farm slot. */
const HUSBANDRY_GATES: readonly { readonly jobType: number; readonly good: number }[] = [
  { jobType: JOB_HUNTER, good: GOOD_MEAT },
  { jobType: JOB_HUNTER, good: GOOD_LEATHER },
  { jobType: rebaseSlotJob(JOB_HUNTER), good: GOOD_MEAT },
  { jobType: rebaseSlotJob(JOB_HUNTER), good: GOOD_LEATHER },
  { jobType: rebaseSlotJob(JOB_BREEDER), good: GOOD_SHEEP },
  { jobType: rebaseSlotJob(JOB_BREEDER), good: GOOD_CATTLE },
];

/** Soldier specializations gated on the shorter-weapon trade being present (real ir.json `jobEnablesJob`): the
 *  long blade unlocks behind the short sword, the long bow behind the short bow. */
const SOLDIER_SPECIALIZATIONS: readonly { readonly enabledBy: number; readonly job: number }[] = [
  { enabledBy: JOB_SOLDIER_SWORD, job: JOB_SOLDIER_BROADSWORD },
  { enabledBy: JOB_ARCHER, job: JOB_ARCHER_LONG },
];

/** The primary tribe's full `jobEnables` edge list, assembled from the tables above. */
export const SANDBOX_JOB_ENABLES: readonly JobEnables[] = [
  ...COLLECTOR_GATED_HOUSES.map((targetId) => ({ jobType: JOB_COLLECTOR, kind: 'house', targetId }) as const),
  ...COLLECTOR_GATED_GOODS.map((targetId) => ({ jobType: JOB_COLLECTOR, kind: 'good', targetId }) as const),
  ...HUSBANDRY_GATES.map(({ jobType, good }) => ({ jobType, kind: 'good', targetId: good }) as const),
  ...SOLDIER_SPECIALIZATIONS.map(
    ({ enabledBy, job }) => ({ jobType: enabledBy, kind: 'job', targetId: job }) as const,
  ),
];
