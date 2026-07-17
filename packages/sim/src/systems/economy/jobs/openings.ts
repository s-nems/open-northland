import { Building, JobAssignment, ownerOf, ownersCompatible, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled, jobEnabled, settlerMeetsNeed } from '../../progression/index.js';
import { buildingWorkerJobs } from '../../stores/index.js';

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
 * The first building (canonical order) with an open slot for the SPECIFIC job `jobType` — the
 * report-in scan for a pre-employed but unbound worker (today: the loose carrier, pass 1b). The same
 * per-slot openness gate as {@link openJobAt}, restricted to the one job the settler already
 * holds, or `null` when no building currently offers that job.
 */
export function openPostFor(
  buildings: readonly Entity[],
  world: World,
  ctx: SystemContext,
  tribe: number,
  owner: number | undefined,
  jobType: number,
  experience: ReadonlyMap<number, number>,
  staffing: StaffingTally,
  /** The settler's signpost confinement over a candidate building — an out-of-area workplace never
   *  employs it (see the jobSystem's area gate). Omitted when the settler is unlimited. */
  withinArea?: (building: Entity) => boolean,
): Entity | null {
  for (const b of buildings) {
    if (withinArea !== undefined && !withinArea(b)) continue;
    if (resolveOpenWorkerJob(world, ctx, b, tribe, owner, experience, [jobType], staffing) !== null) {
      return b;
    }
  }
  return null;
}

/**
 * The first workplace (canonical order) that is open for a `tribe` settler with the given accrued
 * `experience`, together with the job it offers — see {@link jobSystem} for the four openness
 * conditions — or `null` if no workplace currently offers it a job.
 */
export function openJobAt(
  buildings: readonly Entity[],
  world: World,
  ctx: SystemContext,
  tribe: number,
  owner: number | undefined,
  experience: ReadonlyMap<number, number>,
  staffing: StaffingTally,
  /** The settler's signpost confinement over a candidate building — see {@link openPostFor}. */
  withinArea?: (building: Entity) => boolean,
): { building: Entity; jobType: number } | null {
  for (const b of buildings) {
    if (withinArea !== undefined && !withinArea(b)) continue;
    const jobType = resolveOpenWorkerJob(
      world,
      ctx,
      b,
      tribe,
      owner,
      experience,
      canonicalJobs(buildingWorkerJobs(world, ctx, b)),
      staffing,
    );
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
 * Unlike the automatic scan, this path RELAXES the job-level tech gate (`jobEnablesJob`) and the per-settler
 * XP threshold (`needforjob`). This is a deliberate player-convenience DEVIATION from the original, not a
 * faithful reading of it: the extracted `tribetypes.ini` gates a specialization on both a tribe-tech
 * progression and accrued settler XP (e.g. the coiner needs `jobEnablesJob 8/13 14` + `needforjob 14 …`), so
 * the original models a fresh 0-XP settler becoming a coiner as impossible. We override that on an explicit
 * hand assignment so a right-click / the assign-workplace button staffs a built workshop with its own trade
 * instead of silently downgrading to the carrier slot (the reported "mennica → tragarz" bug). The
 * building-level gate (`buildingEnabled`) is kept, and the automatic JobSystem still enforces both gates, so
 * the AI never self-unlocks a specialization — only the player can.
 */
export function openWorkerJobFromList(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
  owner: number | undefined,
  experience: ReadonlyMap<number, number>,
  jobPriority: readonly number[],
): number | null {
  const offered = buildingWorkerJobs(world, ctx, building);
  return resolveOpenWorkerJob(
    world,
    ctx,
    building,
    tribe,
    owner,
    experience,
    jobPriority.filter((jobType) => offered.has(jobType)),
    undefined,
    /* playerDirected */ true,
  );
}

/**
 * Walk `orderedJobs` (already a subset of the building's slots) and return the first one open for a
 * `tribe` settler with the given `experience` — understaffed at this building, and (unless `playerDirected`)
 * tech-enabled + XP-cleared — or `null`. The shared core of {@link openJobAt} (canonical order) and
 * {@link openWorkerJobFromList} (priority order): both apply the same tribe/owner/building + capacity gates;
 * they differ in slot order AND in `playerDirected`, which the command path sets to skip the per-slot tech/XP
 * gate (see {@link openWorkerJobFromList} — the deliberate player-convenience deviation).
 */
function resolveOpenWorkerJob(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
  owner: number | undefined,
  experience: ReadonlyMap<number, number>,
  orderedJobs: readonly number[],
  staffing?: StaffingTally,
  playerDirected = false,
): number | null {
  const b = world.tryGet(building, Building);
  if (b === undefined || b.tribe !== tribe) return null;
  if (!ownersCompatible(owner, ownerOf(world, building))) return null; // another player's workplace (sameSide doc)
  if (!buildingEnabled(world, ctx, tribe, b.buildingType)) return null; // not tech-enabled yet
  for (const jobType of orderedJobs) {
    if (!jobUnderstaffed(world, ctx, building, jobType, staffing)) continue;
    // A player-directed assignment (a right-click / the assign-workplace button) staffs a built workshop
    // with its own trade regardless of the job-level tech/XP gate — see openWorkerJobFromList. The automatic
    // scan still enforces both, so the AI never self-unlocks a specialization.
    if (playerDirected) return jobType;
    if (!jobEnabled(world, ctx, tribe, jobType)) continue; // tech gate (jobEnablesJob): job unlocked?
    if (!settlerMeetsNeed(ctx, tribe, 'job', jobType, experience)) continue; // XP gate (needforjob)
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
function jobUnderstaffed(
  world: World,
  ctx: SystemContext,
  building: Entity,
  jobType: number,
  staffing?: StaffingTally,
): boolean {
  const b = world.get(building, Building);
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  const slot = type?.workers.find((w) => w.jobType === jobType);
  if (slot === undefined) return false; // not a worker job here
  // With the jobSystem's per-tick tally the count is O(1); the live scan remains for the one-shot
  // command path (`assignWorker` resolves openness outside a jobSystem tick, no tally in hand).
  const held =
    staffing !== undefined
      ? (staffing.get(building)?.get(jobType) ?? 0)
      : liveHeldCount(world, building, jobType);
  return held < slot.count;
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

/** The job ids of a `workers`-slot set in ascending order, so a multi-slot workplace assigns
 * deterministically (lowest job id first) rather than in `Set` insertion order. */
function canonicalJobs(jobs: ReadonlySet<number>): number[] {
  return [...jobs].sort((a, b) => a - b);
}
