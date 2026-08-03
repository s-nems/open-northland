import { CARRY_CAPACITY } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { neededConstructionGoods, stampSupplyRun } from '../../../stores/index.js';
import { atOrWalk, startPickup } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell, nearestStoreHolding } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';

/**
 * Fetch one still-needed construction good for `site` from a store that holds it; the delivery drive then
 * carries the load back. Tries the least-covered material first but falls through the whole bill, so a good
 * with no source anywhere never blocks the ones that are available. The needs discount other settlers' live
 * supply errands and this fetch stamps its own, so a crew spreads over the still-unclaimed materials
 * instead of racing to the same unit.
 */
export function fetchNeededMaterial(plan: PlannerContext, site: Entity): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  const avoid = unreachableGoalVeto(world, ctx, e);
  for (const need of neededConstructionGoods(world, ctx, site, plan.inbound)) {
    const src = nearestStoreHolding(
      targets.stockpileCells,
      world,
      ctx,
      terrain,
      here,
      need.goodType,
      plan.owner,
      plan.limit ?? undefined,
      avoid,
    );
    if (src == null) continue;
    const batch = Math.min(need.amount, CARRY_CAPACITY);
    stampSupplyRun(world, e, plan.inbound, { site, goodType: need.goodType, amount: batch });
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, src, here), () =>
      startPickup(world, ctx, e, settler, src, need.goodType, batch),
    );
    return true;
  }
  return false;
}
