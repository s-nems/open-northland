import {
  Building,
  JobAssignment,
  prioritizesGood,
  Stockpile,
  sameSideAs,
} from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { buildingBlockedCells } from '../../../footprint/index.js';
import { isLoosePile } from '../../../stores/index.js';
import { carryCapacityOf, pullsHaulingCart } from '../../../vehicles/hauling-cart.js';
import { walkPickupBatch } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import {
  haulableOutputGood,
  type Qualified,
  qualifiedGood,
  strandedPile,
  unclaimedStockOf,
} from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { homeBoundGoodProbe } from './delivery-targets.js';
import { workAreaGate } from './haul-flag-area.js';
import { porterLoadOf, roomLeftForPorters } from './haul-targets.js';
import { isBoundToStorageSink } from './store-policy.js';

/**
 * How far around a porter with a part-loaded cart more of the same good is lifted before the trip home,
 * in half-cell nodes: a few cells, the spread of the heaps a producer drops around its hut. Named
 * approximation: far enough to clear one yard in a trip, too short to cross a village for a second one.
 */
export const CART_TOP_UP_REACH = 12;

/**
 * CART TOP-UP - a store's porter whose cart has room left after a lift fills it from the nearest heap or
 * finished output of the same good within {@link CART_TOP_UP_REACH} of where it stands, and only then
 * takes the load home; with nothing of the good that close, or its own store no longer taking it, it
 * delivers what it has. The reach is from the porter, not the first heap, so a yard is cleared heap by
 * heap up to the cart's room. True while the porter walks to or lifts the top-up. Named addition.
 */
export function planCartTopUp(plan: PlannerContext, load: { goodType: number; amount: number }): boolean {
  const { world, ctx, terrain, entity: e, here, targets, supply } = plan;
  if (!pullsHaulingCart(world, e) || !isBoundToStorageSink(world, ctx, e)) return false;
  if (carryCapacityOf(world, ctx.content, e) <= 0) return false;
  const good = load.goodType;
  if (!homeBoundGoodProbe(plan)(good)) return false;
  const most = priorityRoomFor(plan, good);
  if (most <= 0) return false;
  const sameGood = (goodType: number): boolean => goodType === good;
  const walls = buildingBlockedCells(world, ctx, terrain);
  const more = (candidate: Entity): Qualified<number> | null => {
    if (world.has(candidate, Building)) {
      return qualifiedGood(haulableOutputGood(world, ctx, supply, sameGood, candidate));
    }
    if (!isLoosePile(world, candidate) || !world.has(candidate, Stockpile)) return null;
    if (unclaimedStockOf(world, ctx, supply, candidate, good) <= 0) return null;
    return strandedPile(world, ctx, terrain, walls, candidate) ? null : { payload: good };
  };
  const found = targets.stockpileCells.nearest(
    here,
    more,
    workAreaGate(terrain, here, CART_TOP_UP_REACH, plan.limit),
    unreachableGoalVeto(world, ctx, e),
    sameSideAs(world, plan.owner),
  );
  if (found === null) return false;
  walkPickupBatch(plan, found.entity, found.payload, undefined, most);
  return true;
}

/** How much more of `good` a priority shelf at home takes beyond this porter's own load and its fellow
 *  porters', so a top-up never undoes the priority rung's capped lift; unbounded for any other good. */
function priorityRoomFor(plan: PlannerContext, good: number): number {
  const home = plan.world.tryGet(plan.entity, JobAssignment)?.workplace;
  if (home === undefined || !prioritizesGood(plan.world, home, good)) return Number.POSITIVE_INFINITY;
  return roomLeftForPorters(plan, home, good) - porterLoadOf(plan.world, plan.entity, good);
}
