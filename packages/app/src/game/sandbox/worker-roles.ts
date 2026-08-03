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
 * The four worker roles the badge colours and the right-click assignment priority distinguish - a
 * gatherer (chops/mines/picks a raw good and hauls it to a flag), a carrier (a "tragarz" that ferries
 * goods between stores), a garrison (a bow soldier manning a tower), and a craftsman (a trade like
 * smith/joiner that works inside a workshop).
 * These are the sandbox's role buckets, keyed off the job ids ({@link GATHERERS} all bind the collector
 * (8), {@link JOB_CARRIER} is 24, the archers are 40/41, and every rebased building-slot trade lands high -
 * see `ids/economy/jobs.ts` `rebaseSlotJob`), not a sim concept: the sim treats a carrier as the
 * job-agnostic haul fallback and never names one. Faithful intent: in *Cultures* a gatherer is rarely
 * hand-assigned to a building (it belongs on the map delivering to flags), so the right-click gesture never
 * offers one; a garrison post is the opposite - only a soldier already carrying that bow may take it.
 */
export type WorkerRole = 'gatherer' | 'carrier' | 'garrison' | 'craftsman';

/** The gatherer job ids in the raw `jobtypes.ini` space - the sandbox's own {@link GATHERERS} table
 *  (all collector) plus the extracted outdoor-gatherer trades ({@link EXTRACTED_GATHERER_TRADES}:
 *  collector/hunter/fisher). A settler of one of these harvests a raw good on the map, so it's excluded
 *  from right-click building assignment and draws the gatherer badge colour. Membership is tested against
 *  the canonical (de-rebased) id, so a sandbox-rebased slot id classifies the same as its raw twin. */
const GATHERER_JOB_TYPES: ReadonlySet<number> = new Set([
  ...GATHERERS.map((g) => g.job),
  ...EXTRACTED_GATHERER_TRADES,
]);

/** The garrison-post job ids in the raw `jobtypes.ini` space - the two bow-soldier classes the towers
 *  employ (`logicworker 40/41`). A settler of one of these mans a tower rather than working a trade, and
 *  the post is only ever taken by a soldier already carrying that bow (the sim's own gate,
 *  `economy/jobs/openings.ts`). */
const GARRISON_JOB_TYPES: ReadonlySet<number> = new Set([JOB_ARCHER, JOB_ARCHER_LONG]);

/**
 * Whether right-clicking this building with a settler of `currentJob` means "train this one" rather than
 * "put him to work here". The barracks ({@link systems.isBarracksType}) drills every settler whose trade it
 * does not already employ: a colonist walks in and comes out a soldier, while a carrier still takes the
 * post that keeps its weapons stocked (user rule 2026-07-27). Every other building always employs.
 */
export function trainsRatherThanEmploys(
  def: Pick<BuildingType, 'kind' | 'workers'> | undefined,
  currentJob: number | undefined,
): boolean {
  if (def === undefined || !systems.isBarracksType(def)) return false;
  return currentJob === undefined || !def.workers.some((slot) => slot.jobType === currentJob);
}

/** Classify a worker job into its {@link WorkerRole}: the carrier ({@link JOB_CARRIER}), a gatherer (in
 *  {@link GATHERER_JOB_TYPES}), a garrison post ({@link GARRISON_JOB_TYPES}), or otherwise a craftsman. The
 *  job is de-rebased to its raw id first ({@link canonicalJobType}), so the same job classifies identically
 *  whether it arrived raw (real content) or sandbox-rebased. */
export function workerRoleOf(jobType: number): WorkerRole {
  const raw = canonicalJobType(jobType);
  if (raw === JOB_CARRIER) return 'carrier';
  if (GATHERER_JOB_TYPES.has(raw)) return 'gatherer';
  if (GARRISON_JOB_TYPES.has(raw)) return 'garrison';
  return 'craftsman';
}

/**
 * The right-click assignment priority for a building's worker slots: the jobs a player-directed
 * `assignWorker` may bind, most-preferred first - craftsmen (ascending job id) then the carrier, with
 * gatherers excluded (never hand-assigned to a workshop) and garrison posts excluded (a tower post is only
 * ever taken by a soldier of that class - see {@link assignmentPriorityFor}). The sim walks this list and
 * binds the first job whose slot is open for the settler (see the `assignWorker` command /
 * `openWorkerJobFromList`), so the carrier is the fallback when every craft slot is full or the settler
 * lacks the trade's skill - the original's "make him a tradesman, else a hauler" rule.
 */
export function assignmentPriority(slots: readonly { readonly jobType: number }[] | undefined): number[] {
  const craftsmen: number[] = [];
  const carriers: number[] = [];
  for (const slot of slots ?? []) {
    const role = workerRoleOf(slot.jobType);
    if (role === 'craftsman') craftsmen.push(slot.jobType);
    else if (role === 'carrier') carriers.push(slot.jobType);
    // a gatherer slot (e.g. the joinery's demo woodcutter) and a garrison post are never a default
    // right-click target - skip them
  }
  craftsmen.sort((a, b) => a - b);
  return [...craftsmen, ...carriers];
}

/** Whether `currentJob` is a fighting class AND `slots` is a garrison building's - the case where a
 *  right-click means "man this post", never "take up a trade here". Keyed on the settler's class rather
 *  than on the archer ids alone, so a swordsman aimed at a tower is refused instead of re-traded. */
function isFighterJobType(
  currentJob: number,
  slots: readonly { readonly jobType: number }[] | undefined,
): boolean {
  const soldier = canonicalJobType(currentJob);
  if (soldier < SOLDIER_JOB_MIN || soldier > SOLDIER_JOB_MAX) return false;
  return (slots ?? []).some((slot) => workerRoleOf(slot.jobType) === 'garrison');
}

/** The building's gatherer slots (collector/hunter/fisher), ascending by job id. Empty when the building
 *  employs no gatherer - the signal that a gatherer settler has no place here. */
function gathererSlots(slots: readonly { readonly jobType: number }[] | undefined): number[] {
  return (slots ?? [])
    .map((slot) => slot.jobType)
    .filter((jobType) => workerRoleOf(jobType) === 'gatherer')
    .sort((a, b) => a - b);
}

/**
 * The right-click assignment priority for ONE settler at a building: its current trade first (so a miller
 * re-assigned to a mill stays a miller when a miller slot is open), then the building's default
 * {@link assignmentPriority}. A clean-room convenience (not pinned to observed original behavior): a
 * right-click rarely means "re-trade the specialist I aimed at his own workshop".
 *
 * The priority mirrors the player's intent, most-preferred first, and the sim still gates every candidate,
 * so a full/unoffered/gated trade falls through:
 *  - **A gatherer** (collector/hunter/fisher current trade) keeps the building's CRAFT slots first: aiming a
 *    gatherer at a workshop means "become its tradesman" in the original, and the sim's `needforjob` gate is
 *    what decides - a collector that earned the potter's repeats becomes a potter, one that hasn't falls
 *    through. Its own gatherer slots come next (its exact slot first), so a hunter right-clicked onto a
 *    warehouse is still bound as a gatherer delivering there, with the carrier slot last.
 *  - **A soldier** aimed at a garrison building gets his own post, or nothing at all. The tower also
 *    employs haulers, and falling through would re-trade him into one - which disarms him on the spot.
 *  - **A craftsman/carrier** current trade is promoted only when the building actually offers it.
 *  - **Idle/absent** has no trade to keep, so the default {@link assignmentPriority} stands (gatherers and
 *    garrison posts excluded - a plain settler on a warehouse becomes a carrier, and on a tower a hauler,
 *    never an archer).
 */
export function assignmentPriorityFor(
  currentJob: number | undefined,
  slots: readonly { readonly jobType: number }[] | undefined,
): number[] {
  const base = assignmentPriority(slots);
  if (currentJob === undefined || currentJob === JOB_IDLE) return base;
  if (workerRoleOf(currentJob) === 'gatherer') {
    const gatherers = gathererSlots(slots);
    if (gatherers.length === 0) return base; // no gatherer slot here - craft, else carrier
    const offeredExactly = gatherers.includes(currentJob);
    const ordered = offeredExactly ? [currentJob, ...gatherers.filter((j) => j !== currentJob)] : gatherers;
    // Craft slots keep the lead; the gatherer's own slots sit between them and the carrier fallback.
    const crafts = base.filter((jobType) => workerRoleOf(jobType) === 'craftsman');
    return [...crafts, ...ordered, ...base.filter((jobType) => !crafts.includes(jobType))];
  }
  const offered = (slots ?? []).some((slot) => slot.jobType === currentJob);
  // A FIGHTER aimed at a building that employs any fighting class gets his own post or nothing. Falling
  // through would re-trade a soldier into the tower's hauler slot, and `applyTradeChange` disarms a
  // settler leaving the fighter band - a right-click would drop his weapon and armour on the ground.
  if (isFighterJobType(currentJob, slots)) return offered ? [currentJob] : [];
  if (!offered || base[0] === currentJob) return base;
  return [currentJob, ...base.filter((jobType) => jobType !== currentJob)];
}
