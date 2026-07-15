import type { JobEnables } from '@open-northland/data';
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
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUSHROOM,
  GOOD_STONE,
  GOOD_WOOD,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_COLLECTOR,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SWORD,
} from '../../ids/index.js';

/**
 * The sandbox tribe's `jobEnables` tech graph — what the sim's `buildingEnabled`/`goodEnabled`/`jobEnabled`
 * gate reads. Each edge means a settler of `jobType` being alive in the tribe unlocks `targetId`.
 *
 * Source basis: a faithful subset of the extracted viking `tribetypes.ini jobEnables` (ir.json) — every edge
 * below is a real viking edge, restricted to the collector's economy edges plus the two soldier
 * specializations the sandbox models (not the full 265-edge graph). The sandbox reuses the original typeIds,
 * so the ids resolve against either content base.
 */

/** The economy houses gated on the collector (real ir.json: job 8 is in each one's enabling set); the HQ
 *  carries no edge, the ungated bootstrap building that seeds the first collector. */
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
 *  its production recipe, not its harvest — inert in the sandbox (no recipe outputs these) but the faithful
 *  shape. The food-chain goods are left ungated here: water is ungated in ir.json too, but wheat/flour/bread
 *  are really gated on the farmer/miller/baker — an approximation, since the sandbox omits those enable-jobs. */
const COLLECTOR_GATED_GOODS: readonly number[] = [GOOD_WOOD, GOOD_STONE, GOOD_IRON, GOOD_GOLD, GOOD_MUSHROOM];

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
  ...SOLDIER_SPECIALIZATIONS.map(
    ({ enabledBy, job }) => ({ jobType: enabledBy, kind: 'job', targetId: job }) as const,
  ),
];
