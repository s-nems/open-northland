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

/**
 * A building's worker slots with their job ids rebased ({@link rebaseSlotJob}), or undefined for a
 * building type that employs nobody (homes).
 */
export function workerSlotsFor(typeId: number): readonly { jobType: number; count: number }[] | undefined {
  const slots = BUILDING_WORKER_SLOTS[typeId];
  return slots?.map((w) => ({ jobType: rebaseSlotJob(w.jobType), count: w.count }));
}

/**
 * Extracted worker-slot trades that map to a picker profession, keyed by their original `jobtypes.ini` id
 * (the pre-rebase id used in {@link BUILDING_WORKER_SLOTS}) → the shared profession `key`. The building
 * panel names each such worker via {@link professionLabel}, so a slot trade and the picker read the same
 * word. Trades with no picker counterpart keep a slot-local name below.
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
 * Slot-local Polish names for the worker-slot trades with no picker profession: the generic `collector`
 * (8) the roster instead realizes as the concrete resource gatherers, and the two archer weapon classes
 * (40/41) the one-soldier picker folds into "Żołnierz" but a tower slot still lists by weapon.
 */
const WORKER_SLOT_LOCAL_KEYS: Readonly<Record<number, keyof Messages['profession']>> = {
  [JOB_COLLECTOR]: 'collector',
  [JOB_ARCHER]: 'archer_short',
  [JOB_ARCHER_LONG]: 'archer_long',
};
/** The display name of an extracted worker-slot job, by its original id: the shared profession label
 *  where the trade has one (so it never drifts from the picker), else its slot-local name. The carrier
 *  (24 → {@link JOB_CARRIER}) is named 'Tragarz' where the job is defined, not here. */
export function workerSlotName(originalJobType: number): string {
  const key = WORKER_SLOT_PROFESSION_KEYS[originalJobType];
  const localKey = WORKER_SLOT_LOCAL_KEYS[originalJobType];
  return professionLabel(key ?? localKey ?? 'worker');
}

/**
 * Per-building worker + carrier capacity, by typeId — how many settlers of each job a building employs,
 * so `assignWorker` (and the JobSystem) can staff it and the door-badge shows one marker per worker.
 * Source basis: extracted from `ir.json`'s `workers`, i.e. the `logicworker` keys of each
 * `[logichousetype]` block in `DataCnmd/types/houses.ini`, verbatim — the counts and the worker/carrier
 * split are the original's. The `jobType`s here are the source's own `jobtypes.ini` ids and are rebased
 * clear of the sandbox's own functional job band on the way in ({@link rebaseSlotJob}): the original ids
 * overlap the collector (8), builder (7), and soldier band (31..41), so e.g. original job 8 would otherwise
 * be read as the sandbox's collector and original 40/41 as archers. The carrier job is the one exception:
 * the original's carrier (jobtype 24) is {@link JOB_CARRIER} itself — kept, not rebased (the one job the
 * badge + assignment UI single out as a hauler). Everything else becomes a distinct generic craftsman
 * id (its trade identity is dropped — the deferred global-content id unification); the count and the
 * carrier split — what the player assigns — stay exact. Residences (homes) employ nobody; they carry no
 * row. Kept as sandbox data (not the hand-authored catalog) because the rebase lives in the sandbox job space.
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
