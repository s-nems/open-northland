import { CARRY_CAPACITY } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import {
  accessibleStockAmounts,
  neededConstructionGoods,
  reservedSourceSupplyOf,
  stampSupplyRun,
} from '../../../stores/index.js';
import { atOrWalk, startPickup } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { interactionCell, nearestStoreHolding } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';

/**
 * Fetch one still-needed construction good for `site` from a store that holds it; the delivery drive then
 * carries the load back. Tries the least-covered material first but falls through the whole bill, so a good
 * with no source anywhere never blocks the ones that are available. The needs discount other settlers' live
 * supply errands and this fetch stamps its own, so a crew spreads over the still-unclaimed materials
 * instead of racing to the same unit.
 */
export function fetchNeededMaterial(plan: PlannerContext, spacing: PlannerSpacing, site: Entity): boolean {
  return constructionMaterialResolver(plan, spacing).fetch(site);
}

/** A one-builder resolver: site selection shares one source lookup per good, then consumes the chosen
 * site's cached payload. Reachability and failed-goal state are constant for this resolver's lifetime. */
export function constructionMaterialResolver(
  plan: PlannerContext,
  spacing: PlannerSpacing,
): {
  has(site: Entity): boolean;
  fetch(site: Entity): boolean;
} {
  const bySite = new Map<Entity, FetchableMaterial | null>();
  const needsBySite = new Map<
    Entity,
    ReadonlyArray<{ readonly goodType: number; readonly amount: number }>
  >();
  const sourceByGood = new Map<number, MaterialSource | null>();
  const sourceFor = (goodType: number): MaterialSource | null => {
    const cached = sourceByGood.get(goodType);
    if (cached !== undefined || sourceByGood.has(goodType)) return cached ?? null;
    const source = materialSource(plan, goodType);
    sourceByGood.set(goodType, source);
    return source;
  };
  const resolve = (site: Entity): FetchableMaterial | null => {
    const cached = bySite.get(site);
    if (cached !== undefined || bySite.has(site)) return cached ?? null;
    let needs = needsBySite.get(site);
    if (needs === undefined) {
      needs = neededConstructionGoods(plan.world, plan.ctx, site, plan.inbound);
      needsBySite.set(site, needs);
    }
    const fetch = fetchableMaterial(spacing, site, needs, sourceFor);
    bySite.set(site, fetch);
    return fetch;
  };
  return {
    has: (site) => resolve(site) !== null,
    fetch: (site) => {
      const fetch = resolve(site);
      if (fetch === null) return false;
      startMaterialFetch(plan, site, fetch);
      return true;
    },
  };
}

function startMaterialFetch(plan: PlannerContext, site: Entity, fetch: FetchableMaterial): void {
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
}

interface FetchableMaterial {
  readonly source: Entity;
  readonly goodType: number;
  readonly amount: number;
}

interface MaterialSource {
  readonly source: Entity;
  readonly available: number;
}

/** Pick without claiming, so site allocation and the claiming drive ask exactly the same question. */
function fetchableMaterial(
  spacing: PlannerSpacing,
  site: Entity,
  needs: ReadonlyArray<{ readonly goodType: number; readonly amount: number }>,
  sourceFor: (goodType: number) => MaterialSource | null,
): FetchableMaterial | null {
  // A site with no legal perimeter cell cannot take a delivery, so nothing is fetched for it.
  if (spacing.workCells(site).length === 0) return null;
  for (const need of needs) {
    const source = sourceFor(need.goodType);
    if (source === null) continue;
    const amount = Math.min(need.amount, source.available, CARRY_CAPACITY);
    if (amount > 0) return { source: source.source, goodType: need.goodType, amount };
  }
  return null;
}

function materialSource(plan: PlannerContext, goodType: number): MaterialSource | null {
  const { world, ctx, entity: e, here, targets } = plan;
  const band = targets.bands.holding(goodType);
  if (!band.hasCandidates()) return null;
  const source = nearestStoreHolding(
    targets.bands,
    world,
    here,
    goodType,
    plan.owner,
    plan.limit ?? undefined,
    unreachableGoalVeto(world, ctx, e),
    plan.inbound,
  );
  if (source === null) return null;
  const stock = accessibleStockAmounts(world, source)?.get(goodType) ?? 0;
  const available = stock - reservedSourceSupplyOf(plan.inbound, source, goodType);
  return available > 0 ? { source, available } : null;
}
