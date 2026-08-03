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
 * Offset lifting extracted worker-slot job ids clear of the sandbox's own functional band (idle 0,
 * builder 7, collector 8, carrier 24, soldiers 31..41, the picker professions - all < 1000).
 */
export const WORKER_SLOT_JOB_BASE = 1000;

/**
 * The worker-slot trades that gather outdoors (`jobtypes.ini`: 8 collector, 15 hunter, 22 fisher), keyed
 * by their original id. A named approximation, since `ir.json` carries no role field; it agrees with
 * `UserShouldAttachWorkPlaceAfterJobChangeFlag`.
 */
export const EXTRACTED_GATHERER_TRADES: ReadonlySet<number> = new Set([
  JOB_COLLECTOR,
  JOB_HUNTER,
  JOB_FISHER,
]);

/** The slot trades that keep their own `jobtypes.ini` id: the sim classifies them by id slug
 *  (`jobRoleOfId`), which a synthetic `worker_*` id would strip. */
const UNREBASED_SLOT_JOBS: ReadonlySet<number> = new Set([
  JOB_CARRIER,
  JOB_HUNTER,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
]);

export function rebaseSlotJob(jobType: number): number {
  return UNREBASED_SLOT_JOBS.has(jobType) ? jobType : WORKER_SLOT_JOB_BASE + jobType;
}

/**
 * Map a job id back to its raw `jobtypes.ini` id, so a role is classified in one id space whether it
 * arrived as a raw real-content id or a sandbox-rebased slot id.
 */
export function canonicalJobType(jobType: number): number {
  return jobType >= WORKER_SLOT_JOB_BASE ? jobType - WORKER_SLOT_JOB_BASE : jobType;
}

export const JOB_FARMER_SLOT = WORKER_SLOT_JOB_BASE + JOB_FARMER;
export const JOB_MILLER_SLOT = WORKER_SLOT_JOB_BASE + JOB_MILLER;
