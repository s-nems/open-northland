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

/** Badge and assignment buckets owned by this package: the sim groups no trade this way. */
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
 * The jobs a player-directed `assignWorker` may bind here for a settler without a trade, most-preferred
 * first. The sim binds the first open one, so the trailing carrier is the original's "make him a
 * tradesman, else a hauler" fallback. Gatherer and garrison slots take only a settler already in that
 * trade.
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
 *  tower, or any soldier aimed at a storehouse, is refused instead of re-traded. */
function isFighterJobType(currentJob: number): boolean {
  const soldier = canonicalJobType(currentJob);
  return soldier >= SOLDIER_JOB_MIN && soldier <= SOLDIER_JOB_MAX;
}

/**
 * Assignment priority for one settler here: a building that employs its current trade posts it in that
 * trade, gatherers included (owner ruling); otherwise the building default applies. Slots match by
 * canonical trade, so a sandbox-rebased slot seats its raw twin.
 */
export function assignmentPriorityFor(
  currentJob: number | undefined,
  slots: readonly { readonly jobType: number }[] | undefined,
): number[] {
  const base = assignmentPriority(slots);
  if (currentJob === undefined || currentJob === JOB_IDLE) return base;
  const trade = canonicalJobType(currentJob);
  const own = (slots ?? [])
    .map((slot) => slot.jobType)
    .filter((jobType) => canonicalJobType(jobType) === trade);
  // A fighter gets his own post or nothing: falling through to a tower's or storehouse's hauler slot would
  // leave the fighter band, and `applyTradeChange` disarms a settler that does.
  if (isFighterJobType(currentJob)) return own;
  return [...own, ...base.filter((jobType) => !own.includes(jobType))];
}
