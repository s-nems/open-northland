import {
  GatherSelection,
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
import { atomicDuration } from '../../../readviews/animations.js';
import { isHunterJob } from '../../../readviews/index.js';
import { workplaceStocksGood, workplaceStoredGoods } from '../../../stores/index.js';
import { atOrWalk, startAtomic, walkPickupBatch } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { IdleStands } from '../../planner/idle-replan.js';
import {
  interactionCell,
  nearestCollectablePileFor,
  nearestHarvestableFor,
  nearestOwnDropFor,
} from '../../targets/index.js';
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

  // A hunter is bounded to its own hunting ground, the same band the one-kill gate probes, so the gate and
  // the harvest that answers it cannot disagree about what its work is. A body that drifts past every
  // ground has no sweeper left. A hunter with neither flag nor workplace still roams unbounded.
  const hunter = isHunterJob(ctx.content, plan.jobType);
  const ground = hunter ? huntingGround(world, terrain, e) : null;
  const huntArea =
    ground === null ? undefined : { center: ground.anchorCell, radius: carcassReach(plan, ground.radius) };
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
  if (node !== null) {
    startHarvestFromNode(plan, node, harvestClaims);
    return true;
  }
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
  flag: { flag: Entity; radius: number; goodType?: number },
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
  const node = nearestHarvestableFor(plan, {
    exclude: harvestClaims,
    ...(hunter ? { reserved: foreignKill(plan) } : {}),
    area: {
      center: flagCell,
      radius: hunter ? carcassReach(plan, flag.radius) : flag.radius,
      ...(flag.goodType !== undefined && !hunter ? { goodType: flag.goodType } : {}),
    },
  });
  if (node !== null) {
    startHarvestFromNode(plan, node, harvestClaims);
    return true;
  }

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

/** Walk to a node's work cell and start its harvest atomic, claiming the node so colleagues planned later
 *  this pass pick another. */
function startHarvestFromNode(
  plan: PlannerContext,
  node: { entity: Entity; cell: NodeId },
  harvestClaims: HarvestClaims,
): void {
  const { world, ctx, entity: e, here } = plan;
  harvestClaims.add(node.entity);
  const res = world.get(node.entity, Resource);
  atOrWalk(world, e, here, node.cell, () =>
    startAtomic(
      world,
      e,
      res.harvestAtomic,
      { kind: 'harvest', resource: node.entity, goodType: res.goodType },
      atomicDuration(ctx.content, plan, res.harvestAtomic),
      node.entity,
    ),
  );
}
