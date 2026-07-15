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
 * The sandbox tribe's `jobEnables` tech graph — the read side {@link import('@open-northland/sim').systems}
 * `buildingEnabled`/`goodEnabled`/`jobEnabled` gate on. Each edge means "a settler of `jobType` being alive in
 * the tribe unlocks this `targetId`"; a target with no edge is ungated (the HQ, the food-chain goods).
 *
 * Source basis: a faithful SUBSET of the extracted viking `tribetypes.ini jobEnables` (ir.json) restricted to
 * the sandbox's modelled economy. Every edge here is a real viking edge — the collector (`jobtypes.ini` 8) is
 * in the enabling set of every one of these houses and gathered goods in ir.json, and the two soldier
 * specialization edges (long blade / long bow gated on the short one) are the real `jobEnablesJob` edges. The
 * sandbox reuses the original typeIds, so these ids resolve against either content base. Not a copy of the full
 * 265-edge graph: only the collector's economy edges plus the two soldier specializations the sandbox models,
 * enough to exercise the gate the way real content does (a warehouse/workshop stays locked until the tribe has
 * its gatherer — the warehouse-employment catch-22 in browser play).
 */

/** The economy houses gated on a collector being present (real ir.json: job 8 is in each one's enabling set;
 *  the HQ is ungated, the bootstrap building that seeds the first collector). */
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

/** The map-gathered goods gated on the collector (real ir.json `jobEnablesGood 8 <good>`); the food-chain
 *  goods (water/wheat/flour/bread) stay ungated, as in ir.json. Gating a good gates its production recipe, not
 *  its harvest — inert in the sandbox (no recipe outputs these) but the faithful shape. */
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
