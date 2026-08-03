import type { BuildingType } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CARRIER,
  JOB_IDLE,
  SOLDIER_JOB_MAX,
  SOLDIER_JOB_MIN,
} from '../../catalog/jobs.js';
import { canonicalJobType, EXTRACTED_GATHERER_TRADES, GATHERERS } from './ids/index.js';

/**
 * Badge and assignment buckets owned by this package, not a sim concept: the sim treats a carrier as
 * the job-agnostic haul fallback and never names one.
 */
export type WorkerRole = 'gatherer' | 'carrier' | 'garrison' | 'craftsman';

/** Gatherer job ids in the raw `jobtypes.ini` space. Membership is tested against the canonical
 *  de-rebased id, so a sandbox-rebased slot id classifies the same as its raw twin. */
const GATHERER_JOB_TYPES: ReadonlySet<number> = new Set([
  ...GATHERERS.map((g) => g.job),
  ...EXTRACTED_GATHERER_TRADES,
]);

/** The two bow-soldier classes the towers employ (`logicworker 40/41`). */
const GARRISON_JOB_TYPES: ReadonlySet<number> = new Set([JOB_ARCHER, JOB_ARCHER_LONG]);

/**
 * Whether right-clicking this building means "train this one" rather than "put him to work here". Only
 * a barracks trains, and only a settler whose trade it does not already employ, so a carrier still
 * takes the post that keeps its weapons stocked.
 */
export function trainsRatherThanEmploys(
  def: Pick<BuildingType, 'kind' | 'workers'> | undefined,
  currentJob: number | undefined,
): boolean {
  if (def === undefined || !systems.isBarracksType(def)) return false;
  return currentJob === undefined || !def.workers.some((slot) => slot.jobType === currentJob);
}

export function workerRoleOf(jobType: number): WorkerRole {
  const raw = canonicalJobType(jobType);
  if (raw === JOB_CARRIER) return 'carrier';
  if (GATHERER_JOB_TYPES.has(raw)) return 'gatherer';
  if (GARRISON_JOB_TYPES.has(raw)) return 'garrison';
  return 'craftsman';
}

/**
 * The jobs a player-directed `assignWorker` may bind here, most-preferred first. The sim binds the
 * first open one, so the trailing carrier is the original's "make him a tradesman, else a hauler"
 * fallback. Gatherer and garrison slots are never a right-click target.
 */
export function assignmentPriority(slots: readonly { readonly jobType: number }[] | undefined): number[] {
  const craftsmen: number[] = [];
  const carriers: number[] = [];
  for (const slot of slots ?? []) {
    const role = workerRoleOf(slot.jobType);
    if (role === 'craftsman') craftsmen.push(slot.jobType);
    else if (role === 'carrier') carriers.push(slot.jobType);
  }
  craftsmen.sort((a, b) => a - b);
  return [...craftsmen, ...carriers];
}

/** Keyed on the settler's fighting class rather than on the archer ids alone, so a swordsman aimed at a
 *  tower is refused instead of re-traded. */
function isFighterJobType(
  currentJob: number,
  slots: readonly { readonly jobType: number }[] | undefined,
): boolean {
  const soldier = canonicalJobType(currentJob);
  if (soldier < SOLDIER_JOB_MIN || soldier > SOLDIER_JOB_MAX) return false;
  return (slots ?? []).some((slot) => workerRoleOf(slot.jobType) === 'garrison');
}

function gathererSlots(slots: readonly { readonly jobType: number }[] | undefined): number[] {
  return (slots ?? [])
    .map((slot) => slot.jobType)
    .filter((jobType) => workerRoleOf(jobType) === 'gatherer')
    .sort((a, b) => a - b);
}

/**
 * Assignment priority for one settler here: its current trade first, then the building default. A
 * clean-room approximation, not observed original behavior. A gatherer keeps the craft slots ahead of
 * its own, so aiming one at a workshop asks it to take up the trade and the sim's `needforjob` gate
 * decides.
 */
export function assignmentPriorityFor(
  currentJob: number | undefined,
  slots: readonly { readonly jobType: number }[] | undefined,
): number[] {
  const base = assignmentPriority(slots);
  if (currentJob === undefined || currentJob === JOB_IDLE) return base;
  if (workerRoleOf(currentJob) === 'gatherer') {
    const gatherers = gathererSlots(slots);
    if (gatherers.length === 0) return base;
    const offeredExactly = gatherers.includes(currentJob);
    const ordered = offeredExactly ? [currentJob, ...gatherers.filter((j) => j !== currentJob)] : gatherers;
    const crafts = base.filter((jobType) => workerRoleOf(jobType) === 'craftsman');
    return [...crafts, ...ordered, ...base.filter((jobType) => !crafts.includes(jobType))];
  }
  const offered = (slots ?? []).some((slot) => slot.jobType === currentJob);
  // A fighter gets his own post or nothing: falling through to the tower's hauler slot would leave the
  // fighter band, and `applyTradeChange` disarms a settler that does.
  if (isFighterJobType(currentJob, slots)) return offered ? [currentJob] : [];
  if (!offered || base[0] === currentJob) return base;
  return [currentJob, ...base.filter((jobType) => jobType !== currentJob)];
}
