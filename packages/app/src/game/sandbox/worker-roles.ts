import {
  canonicalJobType,
  EXTRACTED_GATHERER_TRADES,
  GATHERERS,
  JOB_CARRIER,
  JOB_IDLE,
} from './ids/index.js';

/**
 * The three worker roles the badge colours and the right-click assignment priority distinguish — a
 * gatherer (chops/mines/picks a raw good and hauls it to a flag), a carrier (a "tragarz" that ferries
 * goods between stores), and a craftsman (a trade like smith/joiner that works inside a workshop).
 * These are the sandbox's role buckets, keyed off the job ids ({@link GATHERERS} all bind the collector
 * (8), {@link JOB_CARRIER} is 24, and every rebased building-slot trade lands high — see
 * `ids/economy/jobs.ts` `rebaseSlotJob`), not a sim concept: the sim treats a carrier as the job-agnostic haul
 * fallback and never names one. Faithful intent: in *Cultures* a gatherer is rarely hand-assigned to a
 * building (it belongs on the map delivering to flags), so the right-click gesture never offers one.
 */
export type WorkerRole = 'gatherer' | 'carrier' | 'craftsman';

/** The gatherer job ids in the raw `jobtypes.ini` space — the sandbox's own {@link GATHERERS} table
 *  (all collector) plus the extracted outdoor-gatherer trades ({@link EXTRACTED_GATHERER_TRADES}:
 *  collector/hunter/fisher). A settler of one of these harvests a raw good on the map, so it's excluded
 *  from right-click building assignment and draws the gatherer badge colour. Membership is tested against
 *  the canonical (de-rebased) id, so a sandbox-rebased slot id classifies the same as its raw twin. */
const GATHERER_JOB_TYPES: ReadonlySet<number> = new Set([
  ...GATHERERS.map((g) => g.job),
  ...EXTRACTED_GATHERER_TRADES,
]);

/** Classify a worker job into its {@link WorkerRole}: the carrier ({@link JOB_CARRIER}), a gatherer (in
 *  {@link GATHERER_JOB_TYPES}), or otherwise a craftsman. The job is de-rebased to its raw id first
 *  ({@link canonicalJobType}), so the same job classifies identically whether it arrived raw (real
 *  content) or sandbox-rebased. */
export function workerRoleOf(jobType: number): WorkerRole {
  const raw = canonicalJobType(jobType);
  if (raw === JOB_CARRIER) return 'carrier';
  if (GATHERER_JOB_TYPES.has(raw)) return 'gatherer';
  return 'craftsman';
}

/**
 * The right-click assignment priority for a building's worker slots: the jobs a player-directed
 * `assignWorker` may bind, most-preferred first — craftsmen (ascending job id) then the carrier, with
 * gatherers excluded (never hand-assigned to a workshop). The sim walks this list and binds the first job
 * whose slot is open for the settler (see the `assignWorker` command / `openWorkerJobFromList`), so the
 * carrier is the fallback when every craft slot is full or the settler lacks the trade's skill — the
 * original's "make him a tradesman, else a hauler" rule.
 */
export function assignmentPriority(slots: readonly { readonly jobType: number }[] | undefined): number[] {
  const craftsmen: number[] = [];
  const carriers: number[] = [];
  for (const slot of slots ?? []) {
    const role = workerRoleOf(slot.jobType);
    if (role === 'craftsman') craftsmen.push(slot.jobType);
    else if (role === 'carrier') carriers.push(slot.jobType);
    // a gatherer slot (e.g. the joinery's demo woodcutter) is never a right-click target — skip it
  }
  craftsmen.sort((a, b) => a - b);
  return [...craftsmen, ...carriers];
}

/** The building's gatherer slots (collector/hunter/fisher), ascending by job id. Empty when the building
 *  employs no gatherer — the signal that a gatherer settler has no place here. */
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
 *  - **A gatherer** (collector/hunter/fisher current trade) prefers the building's own gatherer slots — its
 *    exact slot when the building offers it, then the building's other gatherer slots — before the default
 *    craftsman→carrier fallback. This is how a hunter right-clicked onto a warehouse (or a smith with a
 *    collector slot) is bound as a gatherer whose delivery target becomes the building. A building with no
 *    gatherer slot leaves the gatherer with the default order (craft → carrier).
 *  - **A craftsman/carrier** current trade is promoted only when the building actually offers it.
 *  - **Idle/absent** has no trade to keep, so the default {@link assignmentPriority} stands (gatherers
 *    excluded — a plain settler on a warehouse becomes a carrier, not a gatherer).
 */
export function assignmentPriorityFor(
  currentJob: number | undefined,
  slots: readonly { readonly jobType: number }[] | undefined,
): number[] {
  const base = assignmentPriority(slots);
  if (currentJob === undefined || currentJob === JOB_IDLE) return base;
  if (workerRoleOf(currentJob) === 'gatherer') {
    const gatherers = gathererSlots(slots);
    if (gatherers.length === 0) return base; // no gatherer slot here — fall to craft/carrier
    const offeredExactly = gatherers.includes(currentJob);
    const ordered = offeredExactly ? [currentJob, ...gatherers.filter((j) => j !== currentJob)] : gatherers;
    return [...ordered, ...base];
  }
  const offered = (slots ?? []).some((slot) => slot.jobType === currentJob);
  if (!offered || base[0] === currentJob) return base;
  return [currentJob, ...base.filter((jobType) => jobType !== currentJob)];
}
