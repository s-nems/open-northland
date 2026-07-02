import { Building, JobAssignment, Position, Settler } from '../../components/index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { interactionTile } from '../footprint.js';
import { buildingEnabled, jobEnabled, settlerMeetsNeed } from '../progression.js';
import { TileBuckets, buildingWorkerJobs, canonicalById, recipeOf } from '../shared.js';

/**
 * JobSystem (assignment half) — give an **idle** settler the job of an understaffed workplace it
 * qualifies for, and **bind it to that specific building** ({@link JobAssignment}).
 *
 * In Cultures a settler isn't born into a fixed trade: an unemployed colonist takes up an open job at
 * a workplace that needs a worker (the original's "assign settlers to buildings"). This slice assigns
 * the job *and records which workplace it is for* — the {@link JobAssignment} binding is the single
 * source of truth the AI planner reads (the walk-to-workplace drive heads for the bound building; the
 * staffs-here pin latches only on it). The settler then walks to / staffs that workplace through the
 * AI planner and the production worker-presence gate.
 *
 * Two passes per settler, in canonical (ascending entity-id) order:
 *  1. **Adopt** — an already-employed settler with no binding that is standing on a workplace it
 *     staffs is bound to the building under its feet. This makes the binding authoritative for a
 *     settler that was spawned pre-employed onto its station (it never went through assignment), with
 *     no behavior change — it was already pinned there by the AI.
 *  2. **Assign** — an idle settler (`jobType === null`) is matched to the FIRST workplace, in
 *     canonical order, that is **open** for it, and bound to it. A workplace is open when ALL hold:
 *      - it is a same-tribe building whose type declares a `workers` slot (`logicworker <job> <count>`
 *        — {@link buildingWorkerJobs}); a building with no worker slot offers no job,
 *      - that worker job is currently **understaffed at that building**: fewer settlers are *bound to
 *        this building* for that job than the slot's `count` (per-building, so two same-type mills
 *        staff independently — see {@link jobUnderstaffed}),
 *      - the building is **tech-enabled** for the tribe ({@link buildingEnabled}),
 *      - the worker **job itself is tech-enabled** for the tribe ({@link jobEnabled} — the
 *        `jobEnablesJob` gate: a job a settler must already be present to unlock), AND
 *      - the settler's accrued XP clears the job's `needforjob` threshold ({@link settlerMeetsNeed}).
 *
 * Determinism: settlers and workplaces are both scanned in canonical (ascending entity-id) order via
 * {@link World.canonicalEntities}, and the first open match wins — so the assignment never depends on
 * component-store insertion history (CLAUDE.md anti-pattern: a Map/Set iteration that *picks* an
 * entity must be canonical, unlike a boolean membership test). No RNG, no wall-clock.
 */
export const jobSystem: System = (world, ctx) => {
  // The workplaces to match against, built ONCE per tick in canonical order (not re-scanned + re-sorted
  // per settler): every worker binding is a Building, so this is the only entity set either pass scans.
  // Turns the assignment from O(settlers · entities · log n) into O(buildings + settlers · buildings).
  const buildings = canonicalById(world.query(Building));
  // Spatial bucket of buildings by their INTERACTION tile (the door cell for a footprint type, the
  // anchor tile otherwise — {@link interactionTile}, passed as the bucket's tile resolver): "adopt"
  // binds the workplace a settler is standing AT (the AI walk-to-station drive delivers an operator to
  // the door, not onto the now-walk-blocked walls), and the O(1) per-settler lookup replaces a full
  // building scan (the jobSystem stress cost — most settlers stand at no door, so most lookups hit the
  // shared empty bucket and do zero work).
  const buildingsByTile = new TileBuckets(world, buildings, (b) => interactionTile(world, ctx, b));
  for (const e of world.canonicalEntities()) {
    const settler = world.tryGet(e, Settler);
    if (settler === undefined || world.has(e, JobAssignment)) continue; // already bound: nothing to do

    if (settler.jobType !== null) {
      // Pass 1 — adopt a pre-employed, unbound settler standing on a workplace it staffs.
      const here = workplaceStaffedHereBy(buildingsByTile, world, ctx, e, settler.tribe, settler.jobType);
      if (here !== null) world.add(e, JobAssignment, { workplace: here });
      continue; // an employed settler is never re-assigned
    }

    // Pass 2 — assign + bind an idle settler to a concrete open workplace.
    const open = openJobAt(buildings, world, ctx, settler.tribe, settler.experience);
    if (open !== null) {
      settler.jobType = open.jobType;
      world.add(e, JobAssignment, { workplace: open.building });
    }
  }
};

/**
 * The first workplace (canonical order) that is open for a `tribe` settler with the given accrued
 * `experience`, together with the job it offers — see {@link jobSystem} for the four openness
 * conditions — or `null` if no workplace currently offers it a job.
 */
function openJobAt(
  buildings: readonly Entity[],
  world: World,
  ctx: SystemContext,
  tribe: number,
  experience: ReadonlyMap<number, number>,
): { building: Entity; jobType: number } | null {
  for (const b of buildings) {
    const building = world.tryGet(b, Building);
    if (building === undefined || building.tribe !== tribe) continue;
    if (!buildingEnabled(world, ctx, tribe, building.buildingType)) continue; // not tech-enabled yet
    for (const jobType of canonicalJobs(buildingWorkerJobs(world, ctx, b))) {
      if (!jobUnderstaffed(world, ctx, b, jobType)) continue;
      if (!jobEnabled(world, ctx, tribe, jobType)) continue; // tech gate (jobEnablesJob): job unlocked?
      if (!settlerMeetsNeed(ctx, tribe, 'job', jobType, experience)) continue; // XP gate (needforjob)
      return { building: b, jobType }; // first open, qualified job wins
    }
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
 * fine — it's not a *pick*, just a sum (CLAUDE.md: only a chosen-entity scan needs canonical order).
 */
function jobUnderstaffed(world: World, ctx: SystemContext, building: Entity, jobType: number): boolean {
  const b = world.get(building, Building);
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  const slot = type?.workers.find((w) => w.jobType === jobType);
  if (slot === undefined) return false; // not a worker job here
  let held = 0;
  for (const e of world.query(Settler, JobAssignment)) {
    if (world.get(e, JobAssignment).workplace !== building) continue;
    if (world.get(e, Settler).jobType === jobType) held++;
  }
  return held < slot.count;
}

/**
 * The workplace a `tribe` settler is standing on that it staffs — used to *adopt* a pre-employed,
 * unbound settler (bind it to the building under its feet). A candidate is a **same-tribe** same-tile
 * {@link Building} with a `recipe` (a producing workplace, not a passive store/HQ) whose `workers`
 * slots name `jobType`. The first such building in canonical order is the binding. Returns the
 * building entity or null.
 *
 * The `tribe` filter keeps the binding consistent with {@link boundWorkplaceTarget} (the walk drive,
 * which rejects a cross-tribe binding) — so we never adopt a settler onto an other-tribe workshop it
 * happens to stand on. Mirrors the AI staffs-here pin's predicate (recipe + worker-job + same tile),
 * so the building the JobSystem adopts is exactly the one the AI already holds the settler on.
 * Determinism: canonical scan for the *pick* (the building chosen as the binding), so the adoption
 * never depends on store order.
 */
function workplaceStaffedHereBy(
  buildingsByTile: TileBuckets,
  world: World,
  ctx: SystemContext,
  settler: Entity,
  tribe: number,
  jobType: number,
): Entity | null {
  const sp = world.tryGet(settler, Position);
  if (sp === undefined) return null;
  // Only the buildings whose interaction tile is the settler's own tile can be adopted — the bucket
  // already restricts to them (in ascending-id order), so the loop just applies the type gates.
  for (const b of buildingsByTile.at(fx.toInt(sp.x), fx.toInt(sp.y))) {
    const building = world.get(b, Building); // present: the bucket is built from the Building query
    if (building.tribe !== tribe) continue;
    if (recipeOf(world, ctx, b) === undefined) continue; // only a producing workplace pins its worker
    if (!buildingWorkerJobs(world, ctx, b).has(jobType)) continue; // not a job this workplace employs
    return b;
  }
  return null;
}

/** The job ids of a `workers`-slot set in ascending order, so a multi-slot workplace assigns
 * deterministically (lowest job id first) rather than in `Set` insertion order. */
function canonicalJobs(jobs: ReadonlySet<number>): number[] {
  return [...jobs].sort((a, b) => a - b);
}
