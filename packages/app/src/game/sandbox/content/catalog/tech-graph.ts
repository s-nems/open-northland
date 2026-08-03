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

/** Gated on the collector (`ir.json jobEnablesGood 8 <good>`). A good's gate blocks its production recipe,
 *  not its harvest. Wheat, flour and bread stay ungated here, a named approximation: the sandbox omits the
 *  farmer/miller/baker jobs that really gate them. */
const COLLECTOR_GATED_GOODS: readonly number[] = [GOOD_WOOD, GOOD_STONE, GOOD_IRON, GOOD_GOLD, GOOD_MUSHROOM];

/** Source basis: `ir.json jobEnablesGood`. Wool carries no edge there, so it stays ungated here. The
 *  sandbox hunter exists both as a picker profession and as a rebased house slot, so both ids gate. */
const HUSBANDRY_GATES: readonly { readonly jobType: number; readonly good: number }[] = [
  { jobType: JOB_HUNTER, good: GOOD_MEAT },
  { jobType: JOB_HUNTER, good: GOOD_LEATHER },
  { jobType: rebaseSlotJob(JOB_HUNTER), good: GOOD_MEAT },
  { jobType: rebaseSlotJob(JOB_HUNTER), good: GOOD_LEATHER },
  { jobType: rebaseSlotJob(JOB_BREEDER), good: GOOD_SHEEP },
  { jobType: rebaseSlotJob(JOB_BREEDER), good: GOOD_CATTLE },
];

/** Long-weapon classes gated behind their short-weapon trade (`ir.json jobEnablesJob`). */
const SOLDIER_SPECIALIZATIONS: readonly { readonly enabledBy: number; readonly job: number }[] = [
  { enabledBy: JOB_SOLDIER_SWORD, job: JOB_SOLDIER_BROADSWORD },
  { enabledBy: JOB_ARCHER, job: JOB_ARCHER_LONG },
];

export const SANDBOX_JOB_ENABLES: readonly JobEnables[] = [
  ...COLLECTOR_GATED_HOUSES.map((targetId) => ({ jobType: JOB_COLLECTOR, kind: 'house', targetId }) as const),
  ...COLLECTOR_GATED_GOODS.map((targetId) => ({ jobType: JOB_COLLECTOR, kind: 'good', targetId }) as const),
  ...HUSBANDRY_GATES.map(({ jobType, good }) => ({ jobType, kind: 'good', targetId: good }) as const),
  ...SOLDIER_SPECIALIZATIONS.map(
    ({ enabledBy, job }) => ({ jobType: enabledBy, kind: 'job', targetId: job }) as const,
  ),
];
