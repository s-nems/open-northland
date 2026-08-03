import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_ARMORER,
  JOB_BAKER,
  JOB_BREEDER,
  JOB_BREWER,
  JOB_CARRIER,
  JOB_COIN_MAKER,
  JOB_COLLECTOR,
  JOB_DRUID,
  JOB_FARMER,
  JOB_FISHER,
  JOB_HERBALIST,
  JOB_HUNTER,
  JOB_JOINER,
  JOB_MASON,
  JOB_MILLER,
  JOB_POTTER,
  JOB_SMITH,
  JOB_TAILOR,
} from '../../catalog/jobs.js';
import { type Messages, professionLabel } from '../../i18n/index.js';
import { rebaseSlotJob } from './ids/index.js';

/** Undefined for a building type that employs nobody, such as a home. */
export function workerSlotsFor(typeId: number): readonly { jobType: number; count: number }[] | undefined {
  const slots = BUILDING_WORKER_SLOTS[typeId];
  return slots?.map((w) => ({ jobType: rebaseSlotJob(w.jobType), count: w.count }));
}

/**
 * Keyed by the original pre-rebase `jobtypes.ini` id, so a slot trade and the profession picker read the
 * same word.
 */
const WORKER_SLOT_PROFESSION_KEYS: Readonly<Record<number, keyof Messages['profession']>> = {
  [JOB_JOINER]: 'joiner',
  [JOB_ARMORER]: 'armorer',
  [JOB_POTTER]: 'potter',
  [JOB_MASON]: 'mason',
  [JOB_SMITH]: 'smith',
  [JOB_COIN_MAKER]: 'coin_maker',
  [JOB_HUNTER]: 'hunter',
  [JOB_BREEDER]: 'breeder',
  [JOB_TAILOR]: 'tailor',
  [JOB_FARMER]: 'farmer',
  [JOB_MILLER]: 'miller',
  [JOB_BAKER]: 'baker',
  [JOB_BREWER]: 'brewer',
  [JOB_FISHER]: 'fisher',
  [JOB_HERBALIST]: 'herbalist',
  [JOB_DRUID]: 'druid',
};
/**
 * Slot-local names for the trades the profession picker does not offer: it realizes the generic
 * collector as concrete gatherers and folds both archer classes into one soldier entry.
 */
const WORKER_SLOT_LOCAL_KEYS: Readonly<Record<number, keyof Messages['profession']>> = {
  [JOB_COLLECTOR]: 'collector',
  [JOB_ARCHER]: 'archer_short',
  [JOB_ARCHER_LONG]: 'archer_long',
};
export function workerSlotName(originalJobType: number): string {
  const key = WORKER_SLOT_PROFESSION_KEYS[originalJobType];
  const localKey = WORKER_SLOT_LOCAL_KEYS[originalJobType];
  return professionLabel(key ?? localKey ?? 'worker');
}

/**
 * Extracted verbatim from the `logicworker` keys of each `[logichousetype]` block in
 * `DataCnmd/types/houses.ini`, so the counts and the worker/carrier split are the original's. The
 * `jobType`s are the source's own `jobtypes.ini` ids and get rebased clear of the sandbox job band,
 * because the original ids overlap the sandbox collector and builder. The carrier, hunter and the two
 * tower archers are kept unrebased: the sandbox band defines exactly those trades.
 */
export const BUILDING_WORKER_SLOTS: Readonly<Record<number, readonly { jobType: number; count: number }[]>> =
  {
    1: [
      { jobType: JOB_CARRIER, count: 3 },
      { jobType: JOB_COLLECTOR, count: 3 },
      { jobType: JOB_FISHER, count: 3 },
      { jobType: JOB_HUNTER, count: 3 },
    ], // headquarters
    7: [
      { jobType: JOB_CARRIER, count: 3 },
      { jobType: JOB_COLLECTOR, count: 3 },
      { jobType: JOB_FISHER, count: 3 },
      { jobType: JOB_HUNTER, count: 3 },
    ], // stock_00
    8: [
      { jobType: JOB_CARRIER, count: 3 },
      { jobType: JOB_COLLECTOR, count: 3 },
      { jobType: JOB_FISHER, count: 3 },
      { jobType: JOB_HUNTER, count: 3 },
    ], // stock_01
    9: [
      { jobType: JOB_CARRIER, count: 3 },
      { jobType: JOB_COLLECTOR, count: 3 },
      { jobType: JOB_FISHER, count: 3 },
      { jobType: JOB_HUNTER, count: 3 },
    ], // stock_02
    10: [{ jobType: JOB_CARRIER, count: 1 }], // work_well_00
    11: [{ jobType: JOB_CARRIER, count: 1 }], // work_hive_00
    12: [
      { jobType: JOB_FARMER, count: 4 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_farm_00
    13: [
      { jobType: JOB_MILLER, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_mill_00
    14: [
      { jobType: JOB_BAKER, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_bakery_00
    15: [
      { jobType: JOB_BAKER, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_bakery_01
    16: [
      { jobType: JOB_BREWER, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_brewery
    17: [
      { jobType: JOB_BREEDER, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_animal_farm
    18: [
      { jobType: JOB_TAILOR, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_sewery_00
    19: [
      { jobType: JOB_TAILOR, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_sewery_01
    20: [
      { jobType: JOB_POTTER, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_pottery_00
    21: [
      { jobType: JOB_POTTER, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 2 },
    ], // work_pottery_01
    23: [
      { jobType: JOB_JOINER, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_joinery_00
    24: [
      { jobType: JOB_JOINER, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_joinery_01
    25: [
      { jobType: JOB_JOINER, count: 3 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_joinery_02
    26: [
      { jobType: JOB_JOINER, count: 3 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_joinery_03
    27: [
      { jobType: JOB_ARMORER, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_armory_00
    28: [
      { jobType: JOB_ARMORER, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 2 },
    ], // work_armory_01
    29: [
      { jobType: JOB_MASON, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_mason_hut_00
    30: [
      { jobType: JOB_MASON, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_mason_hut_01
    31: [
      { jobType: JOB_SMITH, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 2 },
    ], // work_smithy_00
    32: [
      { jobType: JOB_SMITH, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 2 },
    ], // work_smithy_01
    33: [
      { jobType: JOB_COIN_MAKER, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 2 },
    ], // work_coin_mint
    34: [
      { jobType: JOB_HERBALIST, count: 3 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_herb_hut
    35: [
      { jobType: JOB_DRUID, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 1 },
    ], // work_druid_00
    36: [
      { jobType: JOB_DRUID, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: JOB_COLLECTOR, count: 2 },
    ], // work_druid_01
    39: [{ jobType: JOB_CARRIER, count: 4 }], // barracks
    40: [
      { jobType: JOB_ARCHER, count: 3 },
      { jobType: JOB_ARCHER_LONG, count: 3 },
      { jobType: JOB_CARRIER, count: 3 },
    ], // tower_00
    41: [
      { jobType: JOB_ARCHER, count: 4 },
      { jobType: JOB_ARCHER_LONG, count: 4 },
      { jobType: JOB_CARRIER, count: 4 },
    ], // tower_01
  };
