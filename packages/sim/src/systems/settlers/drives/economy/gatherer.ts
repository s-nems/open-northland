import {
  GatherSelection,
  HarvestFocus,
  JobAssignment,
  Position,
  Resource,
  WorkFlag,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import {
  claimedByAnotherHunter,
  HUNT_CARCASS_SLACK_NODES,
  huntingGround,
} from '../../../conflict/hunting/index.js';
import { dynamicBlockOverlay, resourceStanceCells, routeRegions } from '../../../footprint/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { isHunterJob } from '../../../readviews/index.js';
import { manhattan } from '../../../spatial/metric.js';
import { workplaceStocksGood, workplaceStoredGoods } from '../../../stores/index.js';
import { atOrWalk, startAtomic, walkPickupBatch } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { IdleStands } from '../../planner/idle-replan.js';
import {
  interactionCell,
  jobAtomics,
  nearestCollectablePileFor,
  nearestHarvestableFor,
  nearestOwnDropFor,
} from '../../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../../unreachable-goals.js';
import type { HarvestClaims } from './harvest-claims.js';

/**
 * HARVEST / COLLECT - the gatherer drive. A flag-bound gatherer harvests inside its flag's radius; an
 * unbound roamer takes the nearest standing resource or loose trunk of its trade, whichever is nearer,
 * and returns false when nothing is reachable.
 *
 * Harvesting is gated by the job's atomic permissions and the good's `needforgood` XP threshold; collecting
 * an already-dropped good is hauling, not harvesting.
 */
export function planGatherer(plan: PlannerContext, harvestClaims: HarvestClaims, idle: IdleStands): boolean {
  const { world, ctx, terrain, entity: e } = plan;
  const flag = world.tryGet(e, WorkFlag);
  // A stale binding (the flag was removed) falls back to roaming rather than stranding the gatherer.
  if (flag !== undefined && world.has(flag.flag, Position)) {
    return planFlagGatherer(plan, flag, harvestClaims, idle);
  }

  // A building-employed roamer forages only goods its workplace stocks, banked form included: an
  // HQ-employed hunter's meat shelves as food, and filtering the carcass out would wedge him after one
  // kill. A GatherSelection pick narrows it further; an unemployed roamer stays unrestricted.
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  const rawStored = workplace !== undefined ? workplaceStoredGoods(world, plan.ctx, workplace) : undefined;
  const stored =
    rawStored !== undefined
      ? new Set(
          plan.ctx.content.goods
            .map((g) => g.typeId)
            .filter((g) => workplaceStocksGood(plan.ctx, rawStored, g)),
        )
      : undefined;
  const pick = world.tryGet(e, GatherSelection)?.goodType;
  const goodFilter =
    stored !== undefined && pick !== undefined && stored.has(pick) ? new Set([pick]) : stored;

  const hunter = isHunterJob(ctx.content, plan.jobType);
  // A hunter is bounded to its own hunting ground, the same band the one-kill gate probes, so the gate and
  // the harvest that answers it cannot disagree about what its work is. A body that drifts past every
  // ground has no sweeper left. A hunter with neither flag nor workplace still roams unbounded.
  const ground = hunter ? huntingGround(world, terrain, e) : null;
  const huntArea =
    ground === null ? undefined : { center: ground.anchorCell, radius: carcassReach(plan, ground.radius) };
  const focus = focusedHarvest(
    plan,
    harvestClaims,
    (node, goodType) =>
      (goodFilter === undefined || goodFilter.has(goodType)) && !(hunter && foreignKill(plan)(node)),
  );
  if (focus !== null && startHarvestFromNode(plan, focus, harvestClaims, huntArea)) return true;
  const node = nearestHarvestableFor(plan, {
    exclude: harvestClaims,
    ...(goodFilter !== undefined ? { goodFilter } : {}),
    ...(huntArea !== undefined ? { within: huntArea } : {}),
    ...(hunter ? { reserved: foreignKill(plan) } : {}),
  });
  const trunk = nearestCollectablePileFor(plan, {
    ...(goodFilter !== undefined ? { goodFilter } : {}),
    ...(huntArea !== undefined ? { within: huntArea } : {}),
  });
  const nodeDist = node !== null ? node.dist : Number.POSITIVE_INFINITY;
  // On a tie prefer the already-felled trunk over a fresh tree.
  if (trunk !== null && trunk.dist <= nodeDist) {
    walkPickupBatch(plan, trunk.pile, trunk.goodType);
    return true;
  }
  if (node !== null) return startHarvestFromNode(plan, node, harvestClaims, huntArea);
  return false;
}

/**
 * The flag-bound gatherer: carry off a pile it dug itself first, else harvest the nearest node inside the
 * flag's radius, else idle beside the flag. Clearing its own drop first keeps it from scattering
 * half-emptied trunks. Always returns true, so it never falls through to the porter, carrier, or de-stack
 * rungs; delivering the load stays the carrying rung's job, which routes a `WorkFlag` load to its flag.
 * Source basis: authored.
 */
function planFlagGatherer(
  plan: PlannerContext,
  flag: { flag: Entity; radius: number; goodType?: number | undefined },
  harvestClaims: HarvestClaims,
  idle: IdleStands,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const flagCell = interactionCell(world, ctx, terrain, flag.flag, here);

  const own = nearestOwnDropFor(plan);
  if (own !== null) {
    walkPickupBatch(plan, own.pile, own.goodType);
    return true;
  }
  // A hunter ignores its flag's good filter: a layered carcass re-arms through its goods in turn, so a
  // meat-only pick would strand the body at its leather stage while the one-kill gate held forever.
  const hunter = isHunterJob(ctx.content, plan.jobType);
  const reach = { center: flagCell, radius: hunter ? carcassReach(plan, flag.radius) : flag.radius };
  const focus = focusedHarvest(
    plan,
    harvestClaims,
    (node, goodType) =>
      (flag.goodType === undefined || hunter || goodType === flag.goodType) &&
      !(hunter && foreignKill(plan)(node)),
  );
  if (focus !== null && startHarvestFromNode(plan, focus, harvestClaims, reach)) return true;

  const node = nearestHarvestableFor(plan, {
    exclude: harvestClaims,
    ...(hunter ? { reserved: foreignKill(plan) } : {}),
    area: {
      ...reach,
      ...(flag.goodType !== undefined && !hunter ? { goodType: flag.goodType } : {}),
    },
  });
  if (node !== null && startHarvestFromNode(plan, node, harvestClaims, reach)) return true;

  // Nothing in reach: stand idle beside the flag.
  idle.stand(e, false);
  atOrWalk(world, e, here, flagCell, () => {});
  return true;
}

/**
 * How far from a hunting ground's anchor this scan must still look for a carcass. The one-kill gate
 * measures a body at its anchor while this scan measures the work cell a settler stands on, so the scan
 * must stay a provable superset: any narrower and a body in the outer band reads as standing work the
 * hunter may never select, wedging it off hunting for good.
 */
function carcassReach(plan: PlannerContext, radius: number): number {
  return radius + HUNT_CARCASS_SLACK_NODES + contentIndex(plan.ctx.content).maxResourceWorkOffset;
}

/** The harvest-scan rejection; `claimedByAnotherHunter` owns the rule. */
function foreignKill(plan: PlannerContext): (node: Entity) => boolean {
  const { world, ctx, terrain, entity: e } = plan;
  return (node) => claimedByAnotherHunter(world, ctx, terrain, node, e);
}

/**
 * The node this gatherer is taking up, when it still stands, is still its trade's work, `accepts` still
 * wants its good, no colleague took it this pass and the stance drawn for it is not one its routes just
 * failed on; otherwise the mark is dropped and the scan decides.
 */
function focusedHarvest(
  plan: PlannerContext,
  harvestClaims: HarvestClaims,
  accepts: (node: Entity, goodType: number) => boolean,
): { entity: Entity } | null {
  const { world, ctx, entity: e } = plan;
  const focus = world.tryGet(e, HarvestFocus);
  if (focus === undefined) return null;
  const res = world.tryGet(focus.node, Resource);
  const stanceLost =
    focus.stance !== undefined && isUnreachableGoal(unreachableGoals(world, ctx, e), focus.stance);
  if (
    res !== undefined &&
    res.remaining > 0 &&
    !stanceLost &&
    !harvestClaims.has(focus.node) &&
    jobAtomics(ctx, plan.jobType).has(res.harvestAtomic) &&
    accepts(focus.node, res.goodType)
  ) {
    return { entity: focus.node };
  }
  world.remove(e, HarvestFocus);
  return null;
}

/**
 * Walk to the node's stance and start its harvest atomic, claiming the node so colleagues planned later
 * this pass pick another. The stance is the one this approach already drew, while it still passes the
 * gates, else a fresh draw among the pool cells the settler can route to, remembered with the node. A
 * scan's proven cell stands in when no pool cell passes; a remembered node with none left is dropped
 * and the caller falls through to its scan. Returns whether the harvest was taken up.
 */
function startHarvestFromNode(
  plan: PlannerContext,
  node: { entity: Entity; cell?: NodeId },
  harvestClaims: HarvestClaims,
  bound: { center: NodeId; radius: number } | undefined,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const res = world.get(node.entity, Resource);
  const focus = world.tryGet(e, HarvestFocus);
  const drawn = focus?.node === node.entity ? focus.stance : undefined;
  const passes = stanceGates(plan, bound);
  let stance = drawn !== undefined && passes(drawn) ? drawn : undefined;
  if (stance === undefined) {
    const open = resourceStanceCells(world, terrain, node.entity).filter(passes);
    stance = open.length > 0 ? open[ctx.rng.int(open.length)] : node.cell;
    if (stance === undefined) {
      world.remove(e, HarvestFocus);
      return false;
    }
    world.add(e, HarvestFocus, { node: node.entity, stance });
  }
  harvestClaims.add(node.entity);
  atOrWalk(world, e, here, stance, () =>
    startAtomic(
      world,
      e,
      res.harvestAtomic,
      { kind: 'harvest', resource: node.entity, goodType: res.goodType },
      atomicDuration(ctx.content, plan, res.harvestAtomic),
      node.entity,
    ),
  );
  return true;
}

/**
 * The gates a stance must pass for this settler to walk there, the same ones the harvest scan applies
 * to its proven cell: open under the walk-block overlay, not a goal its routes just failed on, in its
 * static component and routable from where it stands, inside its signpost area and inside `bound`.
 * The settler's own cell always passes.
 */
function stanceGates(
  plan: PlannerContext,
  bound: { center: NodeId; radius: number } | undefined,
): (cell: NodeId) => boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const unreachable = unreachableGoals(world, ctx, e);
  const regions = routeRegions(world, ctx, terrain);
  const gate = plan.limit ?? undefined;
  return (cell) =>
    cell === here ||
    (!blocked.has(cell) &&
      !isUnreachableGoal(unreachable, cell) &&
      terrain.componentOf(cell) === terrain.componentOf(here) &&
      !regions.unroutable(here, cell) &&
      (gate === undefined || gate.allowsNode(cell)) &&
      (bound === undefined || manhattan(terrain, bound.center, cell) <= bound.radius));
}
