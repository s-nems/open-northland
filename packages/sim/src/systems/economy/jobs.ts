import { Building, JobAssignment, Position, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { buildingEnabled, jobEnabled, settlerMeetsNeed } from '../progression/index.js';
import { canonicalById, NodeBuckets } from '../spatial.js';
import { buildingWorkerJobs, isCarrierJob, recipeOf } from '../stores/index.js';
import { farmWorkGood } from './farming.js';

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
 *     no behavior change — it was already pinned there by the AI. **1b. Report in** — a loose
 *     CARRIER not standing on a post takes the first open transport slot anywhere (see the pass 1b
 *     comment): the haul drive works only through a binding, so an unposted carrier would otherwise
 *     never work.
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
 * component-store insertion history (AGENTS.md anti-pattern: a Map/Set iteration that *picks* an
 * entity must be canonical, unlike a boolean membership test). No RNG, no wall-clock.
 */
export const jobSystem: System = (world, ctx) => {
  // The workplaces to match against, built ONCE per tick in canonical order (not re-scanned + re-sorted
  // per settler): every worker binding is a Building, so this is the only entity set either pass scans.
  // Turns the assignment from O(settlers · entities · log n) into O(buildings + settlers · buildings).
  const buildings = canonicalById(world.query(Building));
  // The staffing tally, built ONCE per tick: bound-settler headcount per (building, jobType). Every
  // openness probe this tick reads it instead of re-scanning all JobAssignments per candidate building
  // (which made an unassignable settler cost O(buildings × assignments) EVERY tick — the report-in
  // pass would have paid that forever for a slotless loose carrier). A commutative count, so the query
  // iteration order is free; each binding made below increments it, so a later settler this tick sees
  // the earlier one's post exactly like the live scan did (sequential consistency preserved).
  const staffing = buildStaffingTally(world);
  // Spatial bucket of buildings by their INTERACTION node (the door node for a footprint type, the
  // anchor node otherwise — {@link interactionNode}, passed as the bucket's node resolver): "adopt"
  // binds the workplace a settler is standing AT (the AI walk-to-station drive delivers an operator to
  // the door, not onto the now-walk-blocked walls), and the O(1) per-settler lookup replaces a full
  // building scan (the jobSystem stress cost — most settlers stand at no door, so most lookups hit the
  // shared empty bucket and do zero work).
  const buildingsByNode = new NodeBuckets(world, buildings, (b) => interactionNode(world, ctx, b));
  for (const e of world.canonicalEntities()) {
    const settler = world.tryGet(e, Settler);
    if (settler === undefined || world.has(e, JobAssignment)) continue; // already bound: nothing to do

    if (settler.jobType !== null) {
      // Pass 1 — adopt a pre-employed, unbound settler standing on a workplace it staffs.
      const here = workplaceStaffedHereBy(buildingsByNode, world, ctx, e, settler.tribe, settler.jobType);
      if (here !== null) {
        bind(world, staffing, e, here, settler.jobType);
      } else if (isCarrierJob(ctx, settler.jobType)) {
        // Pass 1b — a loose CARRIER reports in: transport is worked only through an assignment (the
        // planner's haul rung requires a binding — a carrier without a post does no work), so an
        // unbound carrier takes the first open transport slot in canonical building order (a
        // warehouse's carrier slot, a workshop's `logicworker 24` slot). First-in-canonical-order is
        // a NAMED APPROXIMATION — the original's posting rule isn't decoded; nearest-post would need
        // the spatial seam and can move goldens, so it stays a candidate refinement. Same openness
        // gate as every other assignment; no open slot means it stays loose and idle until one appears.
        const post = openPostFor(
          buildings,
          world,
          ctx,
          settler.tribe,
          settler.jobType,
          settler.experience,
          staffing,
        );
        if (post !== null) bind(world, staffing, e, post, settler.jobType);
      }
      continue; // an employed settler is never re-assigned to another trade
    }

    // Pass 2 — assign + bind an idle settler to a concrete open workplace.
    const open = openJobAt(buildings, world, ctx, settler.tribe, settler.experience, staffing);
    if (open !== null) {
      settler.jobType = open.jobType;
      bind(world, staffing, e, open.building, open.jobType);
    }
  }
};

/** Bound-settler headcount per (building, jobType) — see the jobSystem tally comment. */
type StaffingTally = Map<Entity, Map<number, number>>;

function buildStaffingTally(world: World): StaffingTally {
  const tally: StaffingTally = new Map();
  for (const e of world.query(Settler, JobAssignment)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null) continue;
    const workplace = world.get(e, JobAssignment).workplace;
    incrementStaffing(tally, workplace, jobType);
  }
  return tally;
}

/** Stamp the binding AND reflect it into the tick's staffing tally, so every later openness probe
 *  this tick counts it (the live-scan behavior the tally replaced). */
function bind(world: World, staffing: StaffingTally, e: Entity, workplace: Entity, jobType: number): void {
  world.add(e, JobAssignment, { workplace });
  incrementStaffing(staffing, workplace, jobType);
}

function incrementStaffing(tally: StaffingTally, workplace: Entity, jobType: number): void {
  const jobs = tally.get(workplace) ?? new Map<number, number>();
  jobs.set(jobType, (jobs.get(jobType) ?? 0) + 1);
  tally.set(workplace, jobs);
}

/**
 * The first building (canonical order) with an open slot for the SPECIFIC job `jobType` — the
 * report-in scan for a pre-employed but unbound worker (today: the loose carrier, pass 1b). The same
 * per-slot openness gate as {@link openWorkerJobAt}, restricted to the one job the settler already
 * holds, or `null` when no building currently offers that job.
 */
function openPostFor(
  buildings: readonly Entity[],
  world: World,
  ctx: SystemContext,
  tribe: number,
  jobType: number,
  experience: ReadonlyMap<number, number>,
  staffing: StaffingTally,
): Entity | null {
  for (const b of buildings) {
    if (resolveOpenWorkerJob(world, ctx, b, tribe, experience, [jobType], staffing) !== null) return b;
  }
  return null;
}

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
  staffing: StaffingTally,
): { building: Entity; jobType: number } | null {
  for (const b of buildings) {
    const jobType = resolveOpenWorkerJob(
      world,
      ctx,
      b,
      tribe,
      experience,
      canonicalJobs(buildingWorkerJobs(world, ctx, b)),
      staffing,
    );
    if (jobType !== null) return { building: b, jobType }; // first open, qualified building wins
  }
  return null;
}

/**
 * The open worker job a `tribe` settler with the given accrued `experience` could take at ONE specific
 * `building`, or `null` if that building offers it none right now. A building offers a job when it is a
 * same-tribe, tech-enabled workplace with a `workers` slot that is **understaffed at this building**,
 * whose job is tech-enabled, and whose `needforjob` XP threshold the settler clears (the four openness
 * conditions of {@link jobSystem}, per-building). The lowest job id among open slots wins
 * ({@link canonicalJobs}). This is the automatic {@link openJobAt} scan's per-building probe; the
 * player-directed `assignWorker` command resolves the same slots through {@link openWorkerJobFromList}
 * (its own preference order over the identical per-slot gate), so a hand assignment can never bind a
 * settler to a job the JobSystem itself wouldn't (the invariant the badge/employment display and the
 * goldens both rely on).
 */
export function openWorkerJobAt(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
  experience: ReadonlyMap<number, number>,
): number | null {
  // The automatic economy scan takes the building's slots in canonical (lowest job id) order.
  return resolveOpenWorkerJob(
    world,
    ctx,
    building,
    tribe,
    experience,
    canonicalJobs(buildingWorkerJobs(world, ctx, building)),
  );
}

/**
 * The open worker job at `building` chosen by the caller's ORDERED `jobPriority` preference rather than
 * canonical job order (the player-directed twin of {@link openWorkerJobAt}): the first job in the list
 * that the building actually offers AND that is open for this settler (same four openness gates). The
 * list is filtered to the building's real slots, so a job the building doesn't employ is skipped, and the
 * per-slot gate still runs on every entry — the priority only reorders/excludes candidates, it can never
 * open a slot the JobSystem would keep shut. Used by the `assignWorker` command so a right-click can
 * prefer a tradesman over a hauler (and never pick a gatherer) without bypassing legality.
 */
export function openWorkerJobFromList(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
  experience: ReadonlyMap<number, number>,
  jobPriority: readonly number[],
): number | null {
  const offered = buildingWorkerJobs(world, ctx, building);
  return resolveOpenWorkerJob(
    world,
    ctx,
    building,
    tribe,
    experience,
    jobPriority.filter((jobType) => offered.has(jobType)),
  );
}

/**
 * Walk `orderedJobs` (already a subset of the building's slots) and return the first one open for a
 * `tribe` settler with the given `experience` — understaffed at this building, tech-enabled, XP-cleared —
 * or `null`. The shared core of {@link openWorkerJobAt} (canonical order) and {@link openWorkerJobFromList}
 * (priority order): both apply the SAME per-slot gate, differing only in the order they try slots in, so a
 * player assignment can never bind a settler to a job the automatic economy wouldn't.
 */
function resolveOpenWorkerJob(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
  experience: ReadonlyMap<number, number>,
  orderedJobs: readonly number[],
  staffing?: StaffingTally,
): number | null {
  const b = world.tryGet(building, Building);
  if (b === undefined || b.tribe !== tribe) return null;
  if (!buildingEnabled(world, ctx, tribe, b.buildingType)) return null; // not tech-enabled yet
  for (const jobType of orderedJobs) {
    if (!jobUnderstaffed(world, ctx, building, jobType, staffing)) continue;
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

/**
 * The workplace a `tribe` settler is standing on that it staffs — used to *adopt* a pre-employed,
 * unbound settler (bind it to the building under its feet). A candidate is a **same-tribe** same-tile
 * {@link Building} that WORKS its workers — a `recipe` workplace (a producing workshop, not a passive
 * store/HQ) or a FARM (a workplace producing a field-farmed good, {@link farmWorkGood} — it has no
 * recipe but its farmers run the field loop) — whose `workers` slots name `jobType`. The first such
 * building in canonical order is the binding. Returns the building entity or null.
 *
 * The `tribe` filter keeps the binding consistent with {@link boundWorkplaceTarget} (the walk drive,
 * which rejects a cross-tribe binding) — so we never adopt a settler onto an other-tribe workshop it
 * happens to stand on. Mirrors the AI staffs-here pin's predicate (recipe + worker-job + same tile),
 * so the building the JobSystem adopts is exactly the one the AI already holds the settler on.
 * Determinism: canonical scan for the *pick* (the building chosen as the binding), so the adoption
 * never depends on store order.
 */
function workplaceStaffedHereBy(
  buildingsByNode: NodeBuckets,
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
  const spNode = nodeOfPosition(sp.x, sp.y);
  for (const b of buildingsByNode.at(spNode.hx, spNode.hy)) {
    const building = world.get(b, Building); // present: the bucket is built from the Building query
    if (building.tribe !== tribe) continue;
    // Only a workplace that WORKS its staff pins them: a recipe workshop, or a farm (field loop).
    if (recipeOf(world, ctx, b) === undefined && farmWorkGood(world, ctx, b) === null) continue;
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
