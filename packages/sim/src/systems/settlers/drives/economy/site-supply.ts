import { CARRY_CAPACITY } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { constructionWorkCell } from '../../../footprint/index.js';
import {
  accessibleStockAmounts,
  neededConstructionGoods,
  reservedSourceSupplyOf,
  stampSupplyRun,
} from '../../../stores/index.js';
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
  const fetch = fetchableMaterial(plan, site);
  if (fetch === null) return false;
  const { world, ctx, terrain, entity: e, here } = plan;
  const settler = plan;
  stampSupplyRun(world, e, plan.inbound, {
    site,
    goodType: fetch.goodType,
    amount: fetch.amount,
    source: fetch.source,
  });
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, fetch.source, here), () =>
    startPickup(world, ctx, e, settler, fetch.source, fetch.goodType, fetch.amount),
  );
  return true;
}

/** Whether `site` has a missing material with reachable, unreserved source stock. */
export function hasFetchableMaterial(plan: PlannerContext, site: Entity): boolean {
  return fetchableMaterial(plan, site) !== null;
}

interface FetchableMaterial {
  readonly source: Entity;
  readonly goodType: number;
  readonly amount: number;
}

/** Pick without claiming, so site allocation and the claiming drive ask exactly the same question. */
function fetchableMaterial(plan: PlannerContext, site: Entity): FetchableMaterial | null {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  if (constructionWorkCell(world, ctx, terrain, site, targets.yard.blocked, here) === null) return null;
  const avoid = unreachableGoalVeto(world, ctx, e);
  for (const need of neededConstructionGoods(world, ctx, site, plan.inbound)) {
    const src = nearestStoreHolding(
      targets.bands,
      world,
      here,
      need.goodType,
      plan.owner,
      plan.limit ?? undefined,
      avoid,
      plan.inbound,
    );
    if (src == null) continue;
    const stock = accessibleStockAmounts(world, src)?.get(need.goodType) ?? 0;
    const available = stock - reservedSourceSupplyOf(plan.inbound, src, need.goodType);
    const amount = Math.min(need.amount, available, CARRY_CAPACITY);
    if (amount > 0) return { source: src, goodType: need.goodType, amount };
  }
  return null;
}
