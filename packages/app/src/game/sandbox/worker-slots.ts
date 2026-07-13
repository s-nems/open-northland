import { type Messages, professionLabel } from '../../i18n/index.js';
import { JOB_CARRIER, rebaseSlotJob } from './ids/index.js';

/**
 * A building's worker slots with their job ids rebased ({@link rebaseSlotJob}), or undefined for a
 * building type that employs nobody (homes).
 */
export function workerSlotsFor(typeId: number): readonly { jobType: number; count: number }[] | undefined {
  const slots = BUILDING_WORKER_SLOTS[typeId];
  return slots?.map((w) => ({ jobType: rebaseSlotJob(w.jobType), count: w.count }));
}

/**
 * Extracted worker-slot trades that map to a picker PROFESSION, keyed by their ORIGINAL `jobtypes.ini` id
 * (the pre-rebase id used in {@link BUILDING_WORKER_SLOTS}) → the shared profession `key`. The building
 * panel names each such worker via {@link professionLabel}, so a slot trade and the picker read the SAME
 * word — they used to be transcribed twice and drifted (joiner was "Cieśla" in the slot table but
 * "Stolarz" in the picker). Trades with no picker counterpart keep a slot-local name below.
 */
const WORKER_SLOT_PROFESSION_KEYS: Readonly<Record<number, keyof Messages['profession']>> = {
  9: 'joiner',
  10: 'armorer',
  11: 'potter',
  12: 'mason',
  13: 'smith',
  14: 'coin_maker',
  15: 'hunter',
  16: 'breeder',
  17: 'tailor', // jobtypes.ini "sewer"
  18: 'farmer',
  19: 'miller',
  20: 'baker',
  21: 'brewer',
  22: 'fisher',
  29: 'herbalist', // jobtypes.ini "herb & mush guy"
  30: 'druid',
};
/**
 * Slot-local Polish names for the worker-slot trades with NO picker profession: the generic `collector`
 * (8) the roster instead realizes as the concrete resource gatherers, and the two archer weapon classes
 * (40/41) the one-soldier picker folds into "Żołnierz" but a tower slot still lists by weapon.
 */
const WORKER_SLOT_LOCAL_KEYS: Readonly<Record<number, keyof Messages['profession']>> = {
  8: 'collector',
  40: 'archer_short',
  41: 'archer_long',
};
/** The display name of an extracted worker-slot job, by its ORIGINAL id: the shared profession label
 *  where the trade has one (so it never drifts from the picker), else its slot-local name. The carrier
 *  (24 → {@link JOB_CARRIER}) is named 'Tragarz' where the job is defined, not here. */
export function workerSlotName(originalJobType: number): string {
  const key = WORKER_SLOT_PROFESSION_KEYS[originalJobType];
  const localKey = WORKER_SLOT_LOCAL_KEYS[originalJobType];
  return professionLabel(key ?? localKey ?? 'worker');
}

/**
 * Per-building WORKER + CARRIER capacity, by typeId — how many settlers of each job a building employs,
 * so `assignWorker` (and the JobSystem) can staff it and the door-badge shows one marker per worker.
 * Source basis: EXTRACTED from `ir.json`'s `workers`, i.e. the `logicworker` keys of each
 * `[logichousetype]` block in `DataCnmd/types/houses.ini`, verbatim — the counts and the worker/carrier
 * split are the original's. The `jobType`s here are the source's own `jobtypes.ini` ids and are REBASED
 * clear of the sandbox's own job band on the way in ({@link rebaseSlotJob}): the original ids overlap the
 * synthetic gatherer band (20..25), the carrier (26), and the soldier band (31..41), so e.g. original job
 * 22 would otherwise be read as the sandbox's MUD GATHERER and original 40/41 as ARCHERS — the bug that
 * let a "carpenter" slot fill with wood gatherers. The CARRIER job is the one exception: the original's
 * carrier (jobtype 24) is rebased to {@link JOB_CARRIER} (the one job the badge + assignment UI single out
 * as a hauler). Everything else becomes a distinct generic craftsman id (its trade identity is dropped —
 * the deferred global-content id unification); the COUNT and the carrier split — what the player assigns —
 * stay exact. Residences (homes) employ nobody; they carry no row. Kept as sandbox data (not the
 * clean-room catalog) because the rebase lives in the sandbox job space.
 */
export const BUILDING_WORKER_SLOTS: Readonly<Record<number, readonly { jobType: number; count: number }[]>> =
  {
    1: [
      { jobType: JOB_CARRIER, count: 3 },
      { jobType: 8, count: 3 },
      { jobType: 22, count: 3 },
      { jobType: 15, count: 3 },
    ], // headquarters
    7: [
      { jobType: JOB_CARRIER, count: 3 },
      { jobType: 8, count: 3 },
      { jobType: 22, count: 3 },
      { jobType: 15, count: 3 },
    ], // stock_00
    8: [
      { jobType: JOB_CARRIER, count: 3 },
      { jobType: 8, count: 3 },
      { jobType: 22, count: 3 },
      { jobType: 15, count: 3 },
    ], // stock_01
    9: [
      { jobType: JOB_CARRIER, count: 3 },
      { jobType: 8, count: 3 },
      { jobType: 22, count: 3 },
      { jobType: 15, count: 3 },
    ], // stock_02
    10: [{ jobType: JOB_CARRIER, count: 1 }], // work_well_00
    11: [{ jobType: JOB_CARRIER, count: 1 }], // work_hive_00
    12: [
      { jobType: 18, count: 4 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_farm_00
    13: [
      { jobType: 19, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_mill_00
    14: [
      { jobType: 20, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_bakery_00
    15: [
      { jobType: 20, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_bakery_01
    16: [
      { jobType: 21, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_brewery
    17: [
      { jobType: 16, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_animal_farm
    18: [
      { jobType: 17, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_sewery_00
    19: [
      { jobType: 17, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_sewery_01
    20: [
      { jobType: 11, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_pottery_00
    21: [
      { jobType: 11, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 2 },
    ], // work_pottery_01
    23: [
      { jobType: 9, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_joinery_00
    24: [
      { jobType: 9, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_joinery_01
    25: [
      { jobType: 9, count: 3 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_joinery_02
    26: [
      { jobType: 9, count: 3 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_joinery_03
    27: [
      { jobType: 10, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_armory_00
    28: [
      { jobType: 10, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 2 },
    ], // work_armory_01
    29: [
      { jobType: 12, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_mason_hut_00
    30: [
      { jobType: 12, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_mason_hut_01
    31: [
      { jobType: 13, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 2 },
    ], // work_smithy_00
    32: [
      { jobType: 13, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 2 },
    ], // work_smithy_01
    33: [
      { jobType: 14, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 2 },
    ], // work_coin_mint
    34: [
      { jobType: 29, count: 3 },
      { jobType: JOB_CARRIER, count: 1 },
    ], // work_herb_hut
    35: [
      { jobType: 30, count: 1 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 1 },
    ], // work_druid_00
    36: [
      { jobType: 30, count: 2 },
      { jobType: JOB_CARRIER, count: 1 },
      { jobType: 8, count: 2 },
    ], // work_druid_01
    39: [{ jobType: JOB_CARRIER, count: 4 }], // barracks
    40: [
      { jobType: 40, count: 3 },
      { jobType: 41, count: 3 },
      { jobType: JOB_CARRIER, count: 3 },
    ], // tower_00
    41: [
      { jobType: 40, count: 4 },
      { jobType: 41, count: 4 },
      { jobType: JOB_CARRIER, count: 4 },
    ], // tower_01
  };
