/** The sandbox's own derived job ids: the rebased worker-slot band and its classification. */
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CARRIER,
  JOB_COLLECTOR,
  JOB_FARMER,
  JOB_FISHER,
  JOB_HUNTER,
  JOB_MILLER,
} from '../../../../catalog/jobs.js';

/**
 * Base offset the extracted building worker-slot job ids are lifted by so they clear the sandbox's own
 * functional job band (idle 0, builder 7, collector 8, carrier 24, soldiers 31..41, the picker
 * professions - all < 1000). A rebased slot job is `BASE + originalId`; {@link UNREBASED_SLOT_JOBS} keep
 * their own. See {@link import('../../worker-slots.js')} `BUILDING_WORKER_SLOTS` for why the rebase is needed.
 */
export const WORKER_SLOT_JOB_BASE = 1000;

/**
 * The extracted worker-slot trades that are outdoor resource gatherers (`jobtypes.ini`: 8 collector,
 * 15 hunter, 22 fisher), keyed by their original id. This hand-classification is an approximation because
 * `ir.json` carries no role field; it agrees with `UserShouldAttachWorkPlaceAfterJobChangeFlag`.
 */
export const EXTRACTED_GATHERER_TRADES: ReadonlySet<number> = new Set([
  JOB_COLLECTOR,
  JOB_HUNTER,
  JOB_FISHER,
]);

/** The slot trades that keep their own `jobtypes.ini` id instead of being rebased, because the sandbox
 *  band already DEFINES them and the sim classifies them by their id slug (`jobRoleOfId`), which a
 *  synthetic `worker_*` id would strip: the carrier, the hunter (a rebased building hunter could never
 *  shoot game) and the two tower archers (a rebased one could never man the tower - see
 *  {@link import('../../worker-slots.js')} `BUILDING_WORKER_SLOTS`). */
const UNREBASED_SLOT_JOBS: ReadonlySet<number> = new Set([
  JOB_CARRIER,
  JOB_HUNTER,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
]);

/** Rebase one extracted slot job clear of the sandbox band, except the trades the sandbox already owns
 *  ({@link UNREBASED_SLOT_JOBS}). */
export function rebaseSlotJob(jobType: number): number {
  return UNREBASED_SLOT_JOBS.has(jobType) ? jobType : WORKER_SLOT_JOB_BASE + jobType;
}

/**
 * De-rebase a job id back to its raw `jobtypes.ini` id - the inverse of {@link rebaseSlotJob} for the ids
 * it lifts (>= {@link WORKER_SLOT_JOB_BASE}), leaving the functional band (builder/collector/carrier/
 * soldiers, all < BASE) untouched. The single normalization seam so a job's role is classified in one id
 * space whether it arrived as a raw real-content id or a sandbox-rebased slot id.
 */
export function canonicalJobType(jobType: number): number {
  return jobType >= WORKER_SLOT_JOB_BASE ? jobType - WORKER_SLOT_JOB_BASE : jobType;
}

/** The rebased farmer worker-slot job, with real field-loop behaviour in the sandbox content. */
export const JOB_FARMER_SLOT = WORKER_SLOT_JOB_BASE + JOB_FARMER;
/** The rebased miller worker-slot job used by the generic producer drive. */
export const JOB_MILLER_SLOT = WORKER_SLOT_JOB_BASE + JOB_MILLER;
