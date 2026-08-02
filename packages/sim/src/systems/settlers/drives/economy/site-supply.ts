import { CARRY_CAPACITY } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { neededConstructionGoods, stampSupplyRun } from '../../../stores/index.js';
import { atOrWalk, startPickup } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell, nearestStoreHolding } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';

/**
 * Fetch one still-needed construction good for `site` from a store that holds it, routing the pickup so the
 * delivery drive carries the load back to the site (which advertises the demand). Tries the least-covered
 * material first but falls through the whole bill: the goods need not arrive in bill order, so a good with no
 * source anywhere never blocks fetching the ones that are available (the site accumulates what it can and
 * waits for the scarce good). One unit per trip (the global {@link CARRY_CAPACITY}). The needs already
 * discount other settlers' live supply errands (SupplyRun), and this fetch stamps its own - so a crew spreads
 * over the still-unclaimed materials instead of racing to the same unit. Returns whether a fetch was started.
 *
 * Shared by the two trades that supply a foundation: the builder raising it
 * ({@link import('./builder.js').planBuilder}) and a carrier posted to the unfinished building
 * ({@link import('./site-staff.js').planSiteStaff}).
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
    if (src == null) continue; // no store holds this material - try the next bill line
    const batch = Math.min(need.amount, CARRY_CAPACITY);
    stampSupplyRun(world, e, plan.inbound, { site, goodType: need.goodType, amount: batch });
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, src, here), () =>
      startPickup(world, ctx, e, settler, src, need.goodType, batch),
    );
    return true;
  }
  return false;
}
