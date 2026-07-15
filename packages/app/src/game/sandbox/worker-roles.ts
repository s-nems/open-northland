import { EXTRACTED_GATHERER_TRADES, GATHERERS, JOB_CARRIER, rebaseSlotJob } from './ids/index.js';

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

/** The gatherer job ids — the sandbox's own {@link GATHERERS} table plus the extracted outdoor-gatherer
 *  trades ({@link EXTRACTED_GATHERER_TRADES}: collector/hunter/fisher, in their rebased slot ids). A
 *  settler of one of these harvests a raw good on the map, so it's excluded from right-click building
 *  assignment and draws the gatherer badge colour. */
const GATHERER_JOB_TYPES: ReadonlySet<number> = new Set([
  ...GATHERERS.map((g) => g.job),
  ...[...EXTRACTED_GATHERER_TRADES].map(rebaseSlotJob),
]);

/** Classify a worker job into its {@link WorkerRole}: a gatherer (in {@link GATHERER_JOB_TYPES}), the
 *  carrier ({@link JOB_CARRIER}), or otherwise a craftsman (every rebased in-workshop trade). */
export function workerRoleOf(jobType: number): WorkerRole {
  if (jobType === JOB_CARRIER) return 'carrier';
  if (GATHERER_JOB_TYPES.has(jobType)) return 'gatherer';
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
