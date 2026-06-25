import { Building, Settler } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import type { System, SystemContext } from './context.js';
import { buildingEnabled, settlerMeetsNeed } from './progression.js';
import { buildingWorkerJobs } from './shared.js';

/**
 * JobSystem (assignment half — the smallest slice) — give an **idle** settler the job of an
 * understaffed workplace it qualifies for.
 *
 * In Cultures a settler isn't born into a fixed trade: an unemployed colonist takes up an open job at
 * a workplace that needs a worker (the original's "assign settlers to buildings"). This is the first
 * slice of that — it only *assigns the job* (sets `Settler.jobType`); the assigned settler then walks
 * to / staffs the workplace through the existing AI planner (`staffsWorkplaceHere`) and the
 * production worker-presence gate. Movement-to-the-workplace, multi-worker balancing, vehicles and
 * carrier slots are later JobSystem slices (docs/ROADMAP.md).
 *
 * An idle settler (`jobType === null`) is matched to the FIRST workplace, in canonical (ascending
 * entity-id) order, that is **open** for it. A workplace is open for the settler when ALL hold:
 *  - it is a same-tribe building whose type declares a `workers` slot (`logicworker <job> <count>` —
 *    {@link buildingWorkerJobs}); a building with no worker slot offers no job,
 *  - that worker job is currently **understaffed**: fewer settlers of that job are alive in the tribe
 *    than the slot's `count` (so we don't over-assign a one-worker sawmill),
 *  - the building is **tech-enabled** for the tribe ({@link buildingEnabled} — a smithy gated on a
 *    carpenter being present offers no smith job until the carpenter exists), AND
 *  - the settler's accrued XP clears the job's `needforjob` threshold
 *    ({@link settlerMeetsNeed} with `target='job'`) — the per-settler "you must have trained enough to
 *    take this job" gate (the deferred ProgressionSystem `needforjob` consumer; the harvest side
 *    already consumes the `needforgood` sibling).
 *
 * Determinism: settlers and workplaces are both scanned in canonical (ascending entity-id) order via
 * {@link World.canonicalEntities}, and the first open match wins — so the assignment never depends on
 * component-store insertion history (CLAUDE.md anti-pattern: a Map/Set iteration that *picks* an
 * entity must be canonical, unlike a boolean membership test). No RNG, no wall-clock.
 */
export const jobSystem: System = (world, ctx) => {
  for (const e of world.canonicalEntities()) {
    const settler = world.tryGet(e, Settler);
    if (settler === undefined || settler.jobType !== null) continue; // only the idle get assigned
    const job = openJobFor(world, ctx, e, settler.tribe, settler.experience);
    if (job !== null) settler.jobType = job;
  }
};

/**
 * The job of the first workplace (canonical order) that is open for `settler` — see {@link jobSystem}
 * for the four openness conditions — or `null` if no workplace currently offers it a job.
 */
function openJobFor(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  tribe: number,
  experience: ReadonlyMap<number, number>,
): number | null {
  for (const b of world.canonicalEntities()) {
    const building = world.tryGet(b, Building);
    if (building === undefined || building.tribe !== tribe) continue;
    if (!buildingEnabled(world, ctx, tribe, building.buildingType)) continue; // not tech-enabled yet
    for (const jobType of canonicalJobs(buildingWorkerJobs(world, ctx, b))) {
      if (!jobUnderstaffed(world, ctx, b, tribe, jobType)) continue;
      if (!settlerMeetsNeed(ctx, tribe, 'job', jobType, experience)) continue; // XP gate (needforjob)
      return jobType; // first open, qualified job wins
    }
  }
  return null;
}

/**
 * Whether `jobType` has an unfilled `workers` slot at workplace `building`: the building type's slot
 * `count` for that job exceeds the number of settlers of that job currently alive in the same tribe.
 * Tribe-wide (not per-building) head-count is the slice's understaffing measure — there is no
 * worker→building assignment record yet, so "is this job short tribe-wide" stands in for "is this
 * specific workplace short" until a later slice binds a worker to its workplace.
 */
function jobUnderstaffed(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
  jobType: number,
): boolean {
  const b = world.get(building, Building);
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  const slot = type?.workers.find((w) => w.jobType === jobType);
  if (slot === undefined) return false; // not a worker job here
  let held = 0;
  for (const e of world.query(Settler)) {
    const s = world.get(e, Settler);
    if (s.tribe === tribe && s.jobType === jobType) held++;
  }
  return held < slot.count;
}

/** The job ids of a `workers`-slot set in ascending order, so a multi-slot workplace assigns
 * deterministically (lowest job id first) rather than in `Set` insertion order. */
function canonicalJobs(jobs: ReadonlySet<number>): number[] {
  return [...jobs].sort((a, b) => a - b);
}
