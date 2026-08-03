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
import {
  interactionCell,
  nearestCollectablePileFor,
  nearestHarvestableFor,
  nearestOwnDropFor,
} from '../../targets/index.js';
import { deliveryTargetFor } from './delivery-targets.js';
import type { HarvestClaims } from './harvest-claims.js';

/**
 * HARVEST / COLLECT - the gatherer drive, in two shapes:
 *
 *  - **Flag-bound** (carries a {@link WorkFlag}): the user-specified collector - it works only the nodes within
 *    its flag's radius, carries off only the trunks/ore it dug itself, delivers to its own flag, and stands
 *    idle beside the flag when nothing is in reach ({@link planFlagGatherer}). It always owns the tick (returns
 *    true), so it never ferries other settlers' goods or de-stacks off its post.
 *  - **Unbound roaming** (no WorkFlag): chops the nearest standing resource its job may harvest, or carries off
 *    the nearest loose trunk of that trade, whichever is nearer, delivering to the nearest capable store.
 *    A roamer EMPLOYED at a stocking building forages only the goods that building stores (its
 *    {@link GatherSelection} pick when set, else all of them). Returns false when nothing is reachable,
 *    falling through to the porter/carrier drives.
 *
 * Harvesting is gated by the job's atomic permissions and the good's `needforgood` XP threshold; collecting an
 * already-dropped good is hauling, not harvesting. Ordered before the porter/carrier drives so a gatherer works
 * its own resources+trunks before ferrying others'. `jobType` is non-null here.
 */
export function planGatherer(plan: PlannerContext, harvestClaims: HarvestClaims): boolean {
  const { world, ctx, terrain, entity: e } = plan;
  const flag = world.tryGet(e, WorkFlag);
  // A live flag binding switches on the bounded collector behaviour; a stale binding (the flag was removed)
  // falls back to roaming so the gatherer is never stranded pointing at a gone flag.
  if (flag !== undefined && world.has(flag.flag, Position)) {
    return planFlagGatherer(plan, flag, harvestClaims);
  }

  // A building-employed roamer forages ONLY for its workplace: goods the bound building's stockpile
  // stores ({@link workplaceStocksGood}, banked form included - an HQ-employed hunter's meat shelves as
  // food, and filtering the carcass out would wedge him after one kill), narrowed to its GatherSelection
  // pick when one is set (the flag-less collector rule - a smithy's collector fetches iron/wood, never
  // the quarry's stone). An unemployed roamer, or one at a store-less building, stays unrestricted.
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

  // A hunter's work is its own HUNTING GROUND (conflict/hunting/), the very band the one-kill gate
  // probes: unbounded, this scan is map-wide, so a hut hunter walks across the map to a kill while its
  // own ground goes unhunted - and the gate and the harvest that must answer it disagree on what its
  // work even is. The trade-off the bound buys: a body that drifts past EVERY ground now has no
  // sweeper left, and nothing rots a carcass, so it stays as a decal. A hunter with neither flag nor
  // workplace has no ground and still roams unbounded.
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
  // Prefer the trunk on a tie (it is the wood already at hand - grab it before a fresh tree).
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
 * The flag-bound gatherer's decision, in priority order (the user-specified behaviour):
 *
 *  1. **Finish your own drop** - if this gatherer has a trunk/ore pile it dug ({@link nearestOwnDropFor}, keyed
 *     by {@link HarvestedBy}), carry it off before starting anything new. Clearing its own drop first keeps it
 *     from scattering half-emptied trunks, and it leaves every other loose pile untouched.
 *  2. **Harvest within the flag radius** - else chop/mine the nearest node inside the flag's work area
 *     ({@link nearestHarvestableFor} with the flag as centre); a felled trunk / mined pile becomes an owned
 *     drop that branch 1 then carries home.
 *  3. **Idle by the flag** - nothing in reach: walk to and hold beside the flag, rather than roaming or
 *     ferrying.
 *
 * Always returns true: a flag-bound gatherer is spoken for every tick (the flag guarantees a fallback target),
 * so it never falls through to the porter / carrier / de-stack rungs. The delivery of a carried load to the
 * flag is the carrying rung's job ({@link deliveryTargetFor} routes a WorkFlag load to its flag).
 */
function planFlagGatherer(
  plan: PlannerContext,
  flag: { flag: Entity; radius: number; goodType?: number },
  harvestClaims: HarvestClaims,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const flagCell = interactionCell(world, ctx, terrain, flag.flag, here);

  // 1. Carry off a trunk/ore this gatherer dug (only its own - foreign piles are left in peace).
  const own = nearestOwnDropFor(plan);
  if (own !== null) {
    walkPickupBatch(plan, own.pile, own.goodType);
    return true;
  }

  // 2. Chop / mine the nearest FREE node within the flag's work radius (nothing beyond it; a node a
  //    colleague already digs is claimed - one digger per node). A hunter's reach adds the kill slack,
  //    and its flag's good filter is IGNORED: a layered carcass re-arms through its goods in turn, so a
  //    meat-only pick would strand the body at its leather stage while the filter-blind one-kill gate
  //    (`huntingGroundHoldsCarcass`) held forever - the whole body is the hunter's work.
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

  // 3. Nothing to dig and nothing of its own to carry - stand idle beside the flag.
  atOrWalk(world, e, here, flagCell, () => {});
  return true;
}

/**
 * How far from a hunting ground's anchor this scan must still look for a carcass. The one-kill gate
 * measures a body at its ANCHOR ({@link claimedByAnotherHunter}'s neighbour, `huntingGroundHoldsCarcass`)
 * while this scan measures the WORK CELL a settler stands on, which `resourceStanceCells` can resolve up
 * to `maxResourceWorkOffset` outward. The scan must therefore be a provable superset of the gate: any
 * narrower and a body in the outer band reads as standing work the hunter may never select, wedging it
 * off hunting for good.
 */
function carcassReach(plan: PlannerContext, radius: number): number {
  return radius + HUNT_CARCASS_SLACK_NODES + contentIndex(plan.ctx.content).maxResourceWorkOffset;
}

/** The harvest-scan rejection behind {@link claimedByAnotherHunter}, which owns the rule. */
function foreignKill(plan: PlannerContext): (node: Entity) => boolean {
  const { world, ctx, terrain, entity: e } = plan;
  return (node) => claimedByAnotherHunter(world, ctx, terrain, node, e);
}

/** Walk to a harvestable node's work cell and start its content-defined harvest atomic - the shared body of
 *  the roaming and flag-bound gatherer's "chop/mine the nearest node" step. Claims the node for this tick,
 *  so colleagues planned later this pass pick other nodes (one digger per node). */
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
