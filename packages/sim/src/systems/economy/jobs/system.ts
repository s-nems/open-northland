import {
  Building,
  CraftSelection,
  GatherSelection,
  JobAssignment,
  ownerOf,
  Position,
  Settler,
  sameSide,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { System, SystemContext } from '../../context.js';
import { interactionNode } from '../../footprint/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { canonicalById, NodeBuckets } from '../../spatial.js';
import { buildingWorkerJobs, isCarrierJob, mergedRecipeOf } from '../../stores/index.js';
import { farmWorkGood } from '../farming.js';
import { jobCanHarvest, removeWorkFlag } from '../flags.js';
import {
  buildStaffingTally,
  incrementStaffing,
  openJobAt,
  openPostFor,
  type StaffingTally,
} from './openings.js';

/**
 * JobSystem (assignment half) — give an idle settler the job of an understaffed workplace it qualifies for,
 * and bind it to that specific building ({@link JobAssignment}).
 *
 * In Cultures a settler isn't born into a fixed trade: an unemployed colonist takes up an open job at a
 * workplace that needs a worker (the original's "assign settlers to buildings"). The {@link JobAssignment}
 * binding it records is the single source of truth the AI planner reads (the walk-to-workplace drive heads for
 * the bound building; the staffs-here pin latches only on it).
 *
 * Two passes per settler, in canonical (ascending entity-id) order — the first open match wins, so the
 * assignment never depends on component-store insertion order (the AGENTS.md rule: a pick must be canonical):
 *  1. **Adopt** — an already-employed settler with no binding that is standing on a workplace it staffs is
 *     bound to the building under its feet. This makes the binding authoritative for a settler spawned
 *     pre-employed onto its station, with no behavior change. **1b. Report in** — a loose carrier not standing
 *     on a post takes the first open transport slot anywhere (see the pass 1b comment): the haul drive works
 *     only through a binding, so an unposted carrier would otherwise never work.
 *  2. **Assign** — an idle settler (`jobType === null`) is matched to the first open workplace, in canonical
 *     order, and bound to it. A workplace is open when all hold:
 *      - it is a same-tribe building whose type declares a `workers` slot (`logicworker <job> <count>`
 *        — {@link buildingWorkerJobs}),
 *      - that worker job is understaffed at that building: fewer settlers are bound to this building for that
 *        job than the slot's `count` (per-building, so two same-type mills staff independently),
 *      - the building is tech-enabled for the tribe ({@link buildingEnabled}),
 *      - the worker job itself is tech-enabled for the tribe ({@link jobEnabled} — the `jobEnablesJob` gate: a
 *        job a settler must already be present to unlock), and
 *      - the settler's accrued XP clears the job's `needforjob` threshold ({@link settlerMeetsNeed}).
 */
export const jobSystem: System = (world, ctx) => {
  // The workplaces to match against, built once per tick in canonical order: every worker binding is a
  // Building, so this is the only entity set either pass scans. O(buildings + settlers · buildings).
  const buildings = canonicalById(world.query(Building));
  // The staffing tally, built once per tick: bound-settler headcount per (building, jobType). Every openness
  // probe this tick reads it instead of re-scanning all JobAssignments per candidate building. A commutative
  // count, so query order is free; each binding below increments it, so a later settler this tick sees the
  // earlier one's post like the live scan did (sequential consistency preserved).
  const staffing = buildStaffingTally(world);
  // Buildings bucketed by their interaction node (the door node for a footprint type, the anchor node
  // otherwise — {@link interactionNode}): "adopt" binds the workplace a settler is standing at, and the O(1)
  // per-settler lookup replaces a full building scan.
  const buildingsByNode = new NodeBuckets(world, buildings, (b) => interactionNode(world, ctx, b));
  const terrain = ctx.terrain;
  for (const e of world.canonicalEntities()) {
    const settler = world.tryGet(e, Settler);
    if (settler === undefined || world.has(e, JobAssignment)) continue; // already bound: nothing to do

    // The settler's signpost confinement over a candidate workplace: an out-of-area building never employs
    // it — employment would immediately send it walking beyond its allowed area. The adopt pass needs no
    // gate (the building is under the settler's feet — inside its local circle by definition).
    const limit = terrain === undefined ? null : navigationLimitFor(world, terrain, e);
    const withinArea =
      limit === null || terrain === undefined
        ? undefined
        : (b: Entity): boolean => {
            const inode = interactionNode(world, ctx, b);
            if (inode === null) return true; // no resolvable cell — leave the openness gates to decide
            return limit.allowsNode(terrain.nodeAtClamped(inode.x, inode.y));
          };

    if (settler.jobType !== null) {
      // Pass 1 — adopt a pre-employed, unbound settler standing on a workplace it staffs.
      const here = workplaceStaffedHereBy(buildingsByNode, world, ctx, e, settler.tribe, settler.jobType);
      if (here !== null) {
        bind(world, ctx, staffing, e, here, settler.jobType);
      } else if (isCarrierJob(ctx, settler.jobType)) {
        // Pass 1b — a loose carrier reports in: transport is worked only through an assignment (the planner's
        // haul rung requires a binding), so an unbound carrier takes the first open transport slot in canonical
        // building order. First-in-canonical-order is a named approximation — the original's posting rule isn't
        // decoded, and nearest-post would need the spatial seam and can move goldens. Same openness gate as
        // every other assignment; no open slot means it stays loose and idle until one appears.
        const post = openPostFor(
          buildings,
          world,
          ctx,
          settler.tribe,
          ownerOf(world, e),
          settler.jobType,
          settler.experience,
          staffing,
          withinArea,
        );
        if (post !== null) bind(world, ctx, staffing, e, post, settler.jobType);
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
      withinArea,
    );
    if (open !== null) {
      settler.jobType = open.jobType;
      bind(world, ctx, staffing, e, open.building, open.jobType);
    }
  }
};

/** Stamp the binding and reflect it into the tick's staffing tally, so every later openness probe this tick
 *  counts it (the live-scan behavior the tally replaced). A gatherer bound to a building carries no work
 *  flag (mirrors `assignWorker`): its harvest scope is the workplace's stored goods, not a flag yard. Any
 *  per-employment pick from a PRIOR post (a demolished workshop's craft/gather selection) dies here too —
 *  the new workplace offers a different product/store set. */
function bind(
  world: World,
  ctx: SystemContext,
  staffing: StaffingTally,
  e: Entity,
  workplace: Entity,
  jobType: number,
): void {
  world.add(e, JobAssignment, { workplace });
  if (jobCanHarvest(ctx, jobType)) removeWorkFlag(world, e);
  world.remove(e, GatherSelection);
  world.remove(e, CraftSelection);
  incrementStaffing(staffing, workplace, jobType);
}

/**
 * The workplace a `tribe` settler is standing on that it staffs — used to adopt a pre-employed, unbound
 * settler (bind it to the building under its feet). A candidate is a same-tribe same-tile {@link Building}
 * that works its workers — a `recipe` workplace (a producing workshop, not a passive store/HQ) or a farm
 * (producing a field-farmed good, {@link farmWorkGood}, with no recipe but a field loop) — whose `workers`
 * slots name `jobType`. The first such building in canonical order is the binding. Returns the building or null.
 *
 * The `tribe` filter keeps the binding consistent with {@link boundWorkplaceTarget} (the walk drive rejects a
 * cross-tribe binding), so we never adopt a settler onto an other-tribe workshop it happens to stand on. It
 * mirrors the AI staffs-here pin's predicate (recipe + worker-job + same tile), so the building adopted here is
 * the one the AI already holds the settler on.
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
    if (mergedRecipeOf(world, ctx, b) === undefined && farmWorkGood(world, ctx, b) === null) continue;
    if (!buildingWorkerJobs(world, ctx, b).has(jobType)) continue; // not a job this workplace employs
    return b;
  }
  return null;
}
