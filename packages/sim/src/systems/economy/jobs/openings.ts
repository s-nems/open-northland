import { Building, JobAssignment, ownerOf, ownersCompatible, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled, jobEnabled, type NeedSubject, settlerMeetsNeed } from '../../progression/index.js';
import { buildingWorkerJobs, canonicalBuildingWorkerJobs } from '../../stores/index.js';

/** Bound-settler headcount per (building, jobType) — see the jobSystem tally comment. */
export type StaffingTally = Map<Entity, Map<number, number>>;

export function buildStaffingTally(world: World): StaffingTally {
  const tally: StaffingTally = new Map();
  for (const e of world.query(Settler, JobAssignment)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null) continue;
    const workplace = world.get(e, JobAssignment).workplace;
    incrementStaffing(tally, workplace, jobType);
  }
  return tally;
}

export function incrementStaffing(tally: StaffingTally, workplace: Entity, jobType: number): void {
  const jobs = tally.get(workplace) ?? new Map<number, number>();
  jobs.set(jobType, (jobs.get(jobType) ?? 0) + 1);
  tally.set(workplace, jobs);
}

/**
 * How an openness probe resolves a slot — the two employment paths, which differ in where the bound-settler
 * headcount comes from and whether the per-slot tech/XP gate applies:
 *  - `automatic`: the JobSystem's own scan, counting against the tick's {@link StaffingTally} and enforcing
 *    every gate.
 *  - `playerDirected`: a hand assignment (the `assignWorker` command), counting live (it resolves outside a
 *    jobSystem tick, with no tally in hand) and relaxing only the tribe-tech gate — see
 *    {@link openWorkerJobFromList}.
 */
export type OpeningsMode =
  | { readonly kind: 'automatic'; readonly staffing: StaffingTally }
  | { readonly kind: 'playerDirected' };

/** The settler-side context every openness probe reads: who is asking ({@link NeedSubject} — the same
 *  tribe/owner/experience triple the `needfor*` gate judges) under which {@link OpeningsMode}. One object
 *  because these always travel together. */
export interface OpeningsQuery extends NeedSubject {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly mode: OpeningsMode;
  /** The settler's signpost confinement over a candidate building — an out-of-area workplace never employs
   *  it (see the jobSystem's area gate). Omitted when the settler is unlimited. */
  readonly withinArea?: ((building: Entity) => boolean) | undefined;
}

/**
 * The first building (canonical order) with an open slot for the SPECIFIC job `jobType` — the
 * report-in scan for a pre-employed but unbound worker (today: the loose carrier, pass 1b). The same
 * per-slot openness gate as {@link openJobAt}, restricted to the one job the settler already
 * holds, or `null` when no building currently offers that job.
 */
export function openPostFor(
  buildings: readonly Entity[],
  query: OpeningsQuery,
  jobType: number,
): Entity | null {
  for (const b of buildings) {
    if (query.withinArea !== undefined && !query.withinArea(b)) continue;
    if (resolveOpenWorkerJob(query, b, [jobType]) !== null) return b;
  }
  return null;
}

/**
 * The first workplace (canonical order) that is open for the querying settler, together with the job it
 * offers — see {@link jobSystem} for the four openness conditions — or `null` if no workplace currently
 * offers it a job.
 */
export function openJobAt(
  buildings: readonly Entity[],
  query: OpeningsQuery,
): { building: Entity; jobType: number } | null {
  const { world, ctx } = query;
  for (const b of buildings) {
    if (query.withinArea !== undefined && !query.withinArea(b)) continue;
    const jobType = resolveOpenWorkerJob(query, b, canonicalBuildingWorkerJobs(world, ctx, b));
    if (jobType !== null) return { building: b, jobType }; // first open, qualified building wins
  }
  return null;
}

/**
 * The open worker job at `building` chosen by the caller's ORDERED `jobPriority` preference rather than
 * canonical job order (the player-directed twin of {@link openJobAt}): the first job in the list
 * that the building actually offers AND has room for. The list is filtered to the building's real slots, so
 * a job the building doesn't employ is skipped, and the same-tribe/same-owner + per-building capacity gates
 * still run on every entry.
 *
 * The two extracted gates on a specialization split here (the coiner carries both: `jobEnablesJob 8/13 14`
 * + `needforjob 14 …`):
 *  - the TRIBE-tech gate (`jobEnablesJob`, "does a settler of the enabling trade live here") is RELAXED, a
 *    deliberate player-convenience deviation: a hand assignment staffs a built workshop with its own trade
 *    instead of silently downgrading to the carrier slot (the reported "mennica → tragarz" bug);
 *  - the per-settler XP threshold (`needforjob`) is ENFORCED, like everywhere else. A trade is earned by
 *    the settler, so a hand assignment cannot mint a 0-XP potter the profession picker refuses to offer;
 *    an unqualified settler falls through to the next listed job, which is the carrier slot — the
 *    original's "make him a tradesman, else a hauler" rule.
 * The building-level gate (`buildingEnabled`) runs on both paths but is currently a feature-wide no-op
 * (see it).
 */
export function openWorkerJobFromList(
  query: OpeningsQuery,
  building: Entity,
  jobPriority: readonly number[],
): number | null {
  const offered = buildingWorkerJobs(query.world, query.ctx, building);
  return resolveOpenWorkerJob(
    query,
    building,
    jobPriority.filter((jobType) => offered.has(jobType)),
  );
}

/**
 * Walk `orderedJobs` (already a subset of the building's slots) and return the first one open for the
 * querying settler — understaffed at this building, XP-cleared, and (unless the mode is `playerDirected`)
 * tribe-tech-enabled — or `null`. The shared core of {@link openJobAt} (canonical order) and
 * {@link openWorkerJobFromList} (priority order): both apply the same tribe/owner/building + capacity gates;
 * they differ in slot order AND in {@link OpeningsMode}, whose `playerDirected` arm skips the tribe-tech gate
 * (see {@link openWorkerJobFromList} — the deliberate player-convenience deviation).
 */
function resolveOpenWorkerJob(
  query: OpeningsQuery,
  building: Entity,
  orderedJobs: readonly number[],
): number | null {
  const { world, ctx, tribe, mode } = query;
  const b = world.tryGet(building, Building);
  if (b === undefined || b.tribe !== tribe) return null;
  if (!ownersCompatible(query.owner, ownerOf(world, building))) return null; // another player's workplace (sameSide doc)
  if (!buildingEnabled(world, ctx, tribe, b.buildingType)) return null; // building-unlock gate (disabled — see buildingEnabled)
  for (const jobType of orderedJobs) {
    if (!jobUnderstaffed(query, building, jobType)) continue;
    // A player-directed assignment skips only the TRIBE-tech gate — see openWorkerJobFromList.
    if (mode.kind === 'automatic' && !jobEnabled(world, ctx, tribe, jobType)) continue; // jobEnablesJob
    if (!settlerMeetsNeed(world, ctx, query, 'job', jobType)) continue; // XP gate (needforjob)
    return jobType;
  }
  return null;
}

/**
 * Whether `jobType` has an unfilled `workers` slot **at this specific** `building`: the building
 * type's slot `count` for that job exceeds the number of settlers *bound to this building* for that
 * job ({@link JobAssignment}). Per-building (not tribe-wide) head-count, so two same-type workplaces
 * each fill their own slots independently — a worker bound to mill A doesn't make mill B look staffed.
 *
 * Determinism: a count of bound settlers (addition commutes), so iterating `query` insertion order is
 * fine — it's not a *pick*, just a sum (AGENTS.md: only a chosen-entity scan needs canonical order).
 */
function jobUnderstaffed(query: OpeningsQuery, building: Entity, jobType: number): boolean {
  const { world, ctx } = query;
  const b = world.get(building, Building);
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  const slot = type?.workers.find((w) => w.jobType === jobType);
  if (slot === undefined) return false; // not a worker job here
  return heldCount(query, building, jobType) < slot.count;
}

/** The bound-settler headcount for one (building, jobType), from whichever source the {@link OpeningsMode}
 *  carries: the jobSystem's per-tick tally (O(1)) or the command path's live scan. */
function heldCount(query: OpeningsQuery, building: Entity, jobType: number): number {
  const { mode } = query;
  switch (mode.kind) {
    case 'automatic':
      return mode.staffing.get(building)?.get(jobType) ?? 0;
    case 'playerDirected':
      return liveHeldCount(query.world, building, jobType);
  }
}

/** The tally-less bound-settler count for one (building, jobType) — the command-path fallback. */
function liveHeldCount(world: World, building: Entity, jobType: number): number {
  let held = 0;
  for (const e of world.query(Settler, JobAssignment)) {
    if (world.get(e, JobAssignment).workplace !== building) continue;
    if (world.get(e, Settler).jobType === jobType) held++;
  }
  return held;
}
