import { Building, JobAssignment, ownerOf, Position, Settler, sameSide } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { System, SystemContext } from '../../context.js';
import { interactionNode } from '../../footprint/index.js';
import { canonicalById, NodeBuckets } from '../../spatial.js';
import { buildingWorkerJobs, isCarrierJob, recipeOf } from '../../stores/index.js';
import { farmWorkGood } from '../farming.js';
import {
  buildStaffingTally,
  incrementStaffing,
  openJobAt,
  openPostFor,
  type StaffingTally,
} from './openings.js';

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
          ownerOf(world, e),
          settler.jobType,
          settler.experience,
          staffing,
        );
        if (post !== null) bind(world, staffing, e, post, settler.jobType);
      }
      continue; // an employed settler is never re-assigned to another trade
    }

    // Pass 2 — assign + bind an idle settler to a concrete open workplace.
    const open = openJobAt(
      buildings,
      world,
      ctx,
      settler.tribe,
      ownerOf(world, e),
      settler.experience,
      staffing,
    );
    if (open !== null) {
      settler.jobType = open.jobType;
      bind(world, staffing, e, open.building, open.jobType);
    }
  }
};

/** Stamp the binding AND reflect it into the tick's staffing tally, so every later openness probe
 *  this tick counts it (the live-scan behavior the tally replaced). */
function bind(world: World, staffing: StaffingTally, e: Entity, workplace: Entity, jobType: number): void {
  world.add(e, JobAssignment, { workplace });
  incrementStaffing(staffing, workplace, jobType);
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
    if (!sameSide(world, settler, b)) continue; // another player's workplace (same tribe isn't same side)
    // Only a workplace that WORKS its staff pins them: a recipe workshop, or a farm (field loop).
    if (recipeOf(world, ctx, b) === undefined && farmWorkGood(world, ctx, b) === null) continue;
    if (!buildingWorkerJobs(world, ctx, b).has(jobType)) continue; // not a job this workplace employs
    return b;
  }
  return null;
}
