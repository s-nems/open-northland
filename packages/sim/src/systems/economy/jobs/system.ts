import { Building, JobAssignment, ownerOf, Position, Settler, sameSide } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { System, SystemContext } from '../../context.js';
import { type InteractionNode, interactionNode } from '../../footprint/index.js';
import { isAnimalTribe } from '../../readviews/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { canonicalById, NodeBuckets } from '../../spatial/nodes.js';
import { buildingWorkerJobs, isCarrierJob, mergedRecipeOf } from '../../stores/index.js';
import { farmWorkGood } from '../fields.js';
import { liveWorkFlag } from '../work-flag.js';
import { bindEmployment } from './binding.js';
import {
  buildStaffingTally,
  incrementStaffing,
  jobUnderstaffed,
  type OpeningsQuery,
  openJobAt,
  openPostFor,
  type StaffingTally,
} from './openings.js';
import { applyTradeChange } from './trade-change.js';

/**
 * JobSystem (assignment half) - give an idle settler the job of an understaffed workplace it qualifies for,
 * and bind it to that specific building ({@link JobAssignment}).
 *
 * In Cultures a settler isn't born into a fixed trade: an unemployed colonist takes up an open job at a
 * workplace that needs a worker (the original's "assign settlers to buildings"). The {@link JobAssignment}
 * binding it records is the single source of truth the AI planner reads (the walk-to-workplace drive heads for
 * the bound building; the staffs-here pin latches only on it).
 *
 * Two passes per settler, in canonical (ascending entity-id) order - the first open match wins, so the
 * assignment never depends on component-store insertion order (the AGENTS.md rule: a pick must be canonical):
 *  1. **Adopt** - an already-employed settler with no binding that is standing on a workplace it staffs, and
 *     whose slots still have room, is bound to the building under its feet. This makes the binding
 *     authoritative for a settler spawned pre-employed onto its station. A gatherer that already works a
 *     flag is exempt ({@link worksAFlag}). **1b. Report in** - a loose carrier not standing
 *     on a post takes the first open transport slot anywhere (see the pass 1b comment): the haul drive works
 *     only through a binding, so an unposted carrier would otherwise never work.
 *  2. **Assign** - an idle settler (`jobType === null`) is matched to the first open workplace, in canonical
 *     order, and bound to it. A workplace is open when all hold:
 *      - it is a same-tribe building whose type declares a `workers` slot (`logicworker <job> <count>`
 *        - {@link buildingWorkerJobs}),
 *      - that worker job is understaffed at that building: fewer settlers are bound to this building for that
 *        job than the slot's `count` (per-building, so two same-type mills staff independently),
 *      - the building is tech-enabled for the tribe ({@link buildingEnabled}),
 *      - the worker job itself is tech-enabled for the tribe ({@link jobEnabled} - the `jobEnablesJob` gate: a
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
  // Keyed over exactly `buildings`, and valid for the whole tick: nothing either pass mutates feeds
  // {@link interactionNode} (Building, Position, the content footprint, terrain bounds).
  const interactionNodes = new Map<Entity, InteractionNode | null>();
  for (const b of buildings) interactionNodes.set(b, interactionNode(world, ctx, b));
  const interactionNodeOf = (b: Entity): InteractionNode | null => interactionNodes.get(b) ?? null;
  // Buildings bucketed by their interaction node: "adopt" binds the workplace a settler is standing at,
  // and the O(1) per-settler lookup replaces a full building scan.
  const buildingsByNode = new NodeBuckets(world, buildings, interactionNodeOf);
  const terrain = ctx.terrain;
  for (const e of canonicalById(unboundSettlers(world))) {
    const settler = world.get(e, Settler);

    // Wildlife never takes a trade: an animal is a permanently idle `jobType: null` Settler, so
    // without this skip every creature on a map re-scans every workplace's openness each tick
    // (O(animals × buildings) - the RTS-scale budget). No opening could ever match anyway: no content
    // building carries an animal tribe, so the workplace-tribe match blocks (NOT the unlock gate - an
    // animal tribe's EMPTY tech graph gates nothing, `tribeUnlockEnabled` answers true).
    if (isAnimalTribe(ctx.content, settler.tribe)) continue;

    // The settler's signpost confinement over a candidate workplace: an out-of-area building never employs
    // it - employment would immediately send it walking beyond its allowed area. The adopt pass needs no
    // gate (the building is under the settler's feet - inside its local circle by definition).
    const limit = terrain === undefined ? null : navigationLimitFor(world, ctx.content, terrain, e);
    const withinArea =
      limit === null || terrain === undefined
        ? undefined
        : (b: Entity): boolean => {
            const inode = interactionNodeOf(b);
            if (inode === null) return true; // no resolvable cell - leave the openness gates to decide
            return limit.allowsNode(terrain.nodeAtClamped(inode.x, inode.y));
          };
    const query: OpeningsQuery = {
      world,
      ctx,
      tribe: settler.tribe,
      owner: ownerOf(world, e),
      experience: settler.experience,
      mode: { kind: 'automatic', staffing },
      withinArea,
    };

    if (settler.jobType !== null) {
      // Pass 1 - adopt a pre-employed, unbound settler standing on a workplace it staffs.
      const here = workplaceStaffedHereBy(buildingsByNode, world, ctx, e, query, settler.jobType);
      if (here !== null) {
        bind(world, ctx, staffing, e, here, settler.jobType);
      } else if (isCarrierJob(ctx, settler.jobType)) {
        // Pass 1b - a loose carrier reports in: transport is worked only through an assignment (the planner's
        // haul rung requires a binding), so an unbound carrier takes the first open transport slot in canonical
        // building order. First-in-canonical-order is a named approximation - the original's posting rule isn't
        // decoded, and nearest-post would need the spatial seam and can move goldens. Same openness gate as
        // every other assignment; no open slot means it stays loose and idle until one appears.
        const post = openPostFor(buildings, query, settler.jobType);
        if (post !== null) bind(world, ctx, staffing, e, post, settler.jobType);
      }
      continue; // an employed settler is never re-assigned to another trade
    }

    // Pass 2: bind an idle settler to a concrete open workplace and put it in that trade. The trade goes
    // on through the shared reset, not by writing `jobType`: an auto-hired settler owes what an ordered one
    // owes. Bound BEFORE the reset so the flag sync sees the posting and skips planting a yard flag that
    // {@link bindEmployment} would destroy on the spot (a hire burst plants one entity each otherwise).
    const open = openJobAt(buildings, query);
    if (open !== null) {
      bind(world, ctx, staffing, e, open.building, open.jobType);
      applyTradeChange(world, ctx, e, open.jobType);
    }
  }
};

/**
 * Whether the settler already has a post: a live work flag. A flag IS a gatherer's workplace (the
 * ground it works and delivers to), so the workshop doors it crosses hauling to and from that flag are
 * incidental. Without this test it is conscripted by whatever door it walks past that employs its
 * trade, and its patch goes unworked - the reported "collectors piling up in the pottery".
 *
 * A pin ({@link setGatherGood}) is not required: the auto-planted flag every fresh gatherer carries
 * (`plantWorkFlagAtFeet`) is just as much a post as a pinned one.
 */
function worksAFlag(world: World, settler: Entity): boolean {
  return liveWorkFlag(world, settler) !== undefined;
}

/** The settlers either pass can act on. Safe to snapshot ahead of the loop: a binding is only ever
 *  stamped on the settler being visited, so no candidate here becomes bound by another's turn. */
function unboundSettlers(world: World): Entity[] {
  const unbound: Entity[] = [];
  for (const e of world.query(Settler)) {
    if (!world.has(e, JobAssignment)) unbound.push(e);
  }
  return unbound;
}

/** Stamp the binding and reflect it into the tick's staffing tally, so every later openness probe this tick
 *  counts it (the live-scan behavior the tally replaced). */
function bind(
  world: World,
  ctx: SystemContext,
  staffing: StaffingTally,
  e: Entity,
  workplace: Entity,
  jobType: number,
): void {
  bindEmployment(world, ctx, e, workplace, jobType);
  incrementStaffing(staffing, workplace, jobType);
}

/**
 * The workplace a settler is standing on that it staffs - used to adopt a pre-employed, unbound
 * settler (bind it to the building under its feet). A candidate is a same-tribe same-tile {@link Building}
 * that works its workers - a `recipe` workplace (a producing workshop, not a passive store/HQ) or a farm
 * (producing a field-farmed good, {@link farmWorkGood}, with no recipe but a field loop) - whose `workers`
 * slots name `jobType` AND still have room for one ({@link jobUnderstaffed}). A gatherer that already works
 * a flag is never adopted ({@link worksAFlag}). The first such building in canonical order is the binding.
 * Returns the building or null.
 *
 * The tribe filter keeps the binding consistent with {@link boundWorkplaceTarget} (the walk drive rejects a
 * cross-tribe binding), so we never adopt a settler onto an other-tribe workshop it happens to stand on. It
 * mirrors the AI staffs-here pin's predicate (recipe + worker-job + same tile), so the building adopted here is
 * the one the AI already holds the settler on. The capacity gate is the only openness rule this pass runs:
 * the tech/XP gates stay off (a map may author a settler onto a station it could not apply for), but a slot
 * count is an invariant - every other path respects it, and without it a workshop beside a busy walking
 * route accumulates unbounded staff.
 */
function workplaceStaffedHereBy(
  buildingsByNode: NodeBuckets,
  world: World,
  ctx: SystemContext,
  settler: Entity,
  query: OpeningsQuery,
  jobType: number,
): Entity | null {
  if (worksAFlag(world, settler)) return null;
  const sp = world.tryGet(settler, Position);
  if (sp === undefined) return null;
  // Only the buildings whose interaction tile is the settler's own tile can be adopted - the bucket
  // already restricts to them (in ascending-id order), so the loop just applies the type gates.
  const spNode = nodeOfPosition(sp.x, sp.y);
  for (const b of buildingsByNode.at(spNode.hx, spNode.hy)) {
    const building = world.get(b, Building); // present: the bucket is built from the Building query
    if (building.tribe !== query.tribe) continue;
    if (!sameSide(world, settler, b)) continue; // another player's workplace (same tribe isn't same side)
    // Only a workplace that WORKS its staff pins them: a recipe workshop, or a farm (field loop).
    if (mergedRecipeOf(world, ctx, b) === undefined && farmWorkGood(world, ctx, b) === null) continue;
    if (!buildingWorkerJobs(world, ctx, b).has(jobType)) continue; // not a job this workplace employs
    if (!jobUnderstaffed(query, b, jobType)) continue; // its slots for this trade are full
    return b;
  }
  return null;
}
