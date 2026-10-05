import { CARRY_CAPACITY, sameSideAs } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { spotsReaching } from '../../../signposts/index.js';
import { accessibleStockAmounts, neededConstructionGoods } from '../../../stores/index.js';
import { atOrWalk, startPickup } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { interactionCell, nearestStoreHolding, type TargetCandidates } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';

/**
 * Fetch one still-needed construction good for `site` from a store that holds it; the delivery drive then
 * carries the load back. Tries the least-covered material first but falls through the whole bill, so a good
 * with no source anywhere never blocks the ones that are available. The needs discount other settlers' live
 * supply errands and this fetch stamps its own, so a crew spreads over the still-unclaimed materials
 * instead of racing to the same unit.
 */
export function fetchNeededMaterial(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  site: Entity,
  /** The fetcher's own workshop, drawn on before any store: a yard worker builds from its own shelves,
   *  recipe inputs included, which no other fetcher may lift. */
  ownShelf?: Entity,
): boolean {
  return constructionMaterialResolver(plan, spacing, { ownShelf }).fetch(site);
}

/** A one-builder resolver: site selection shares one source lookup per good, then consumes the chosen
 * site's cached payload. Reachability and failed-goal state are constant for this resolver's lifetime. */
export function constructionMaterialResolver(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  options: {
    ownShelf?: Entity | undefined;
    /** Only fetch from a source the site lies in reach of: for a site the builder picked within its own
     *  confinement. A site it holds by order or binding takes its load past the confinement, as the
     *  delivery's bound sink does. */
    confined?: SiteSupplyReach | undefined;
  } = {},
): {
  has(site: Entity): boolean;
  fetch(site: Entity): boolean;
  /** Whether a source holds `goodType` for this fetcher, the precondition of every `has` a need of it passes. */
  canSource(goodType: number): boolean;
} {
  const bySite = new Map<Entity, FetchableMaterial | null>();
  const needsBySite = new Map<
    Entity,
    ReadonlyArray<{ readonly goodType: number; readonly amount: number }>
  >();
  const sourceByGood = new Map<number, MaterialSource | null>();
  const { ownShelf, confined } = options;
  const sourceFor = (goodType: number): MaterialSource | null => {
    const cached = sourceByGood.get(goodType);
    if (cached !== undefined || sourceByGood.has(goodType)) return cached ?? null;
    const source =
      (ownShelf === undefined ? null : shelfSource(plan, ownShelf, goodType)) ??
      materialSource(plan, goodType);
    sourceByGood.set(goodType, source);
    return source;
  };
  // The nearest source serves every site it can deliver to; a site out of its reach searches again among
  // the sources that can, which only a split signpost network ever asks for.
  const liftCellByGood = new Map<number, NodeId>();
  const deliveringSourceFor = (site: Entity, goodType: number): MaterialSource | null => {
    const nearest = sourceFor(goodType);
    const { owner, terrain } = plan;
    if (nearest === null || confined === undefined || plan.limit === null || owner === undefined)
      return nearest;
    const delivers = confined.liftSpots(owner, plan.jobType, site);
    if (delivers === null) return nearest;
    let lift = liftCellByGood.get(goodType);
    if (lift === undefined) {
      lift = interactionCell(plan.world, plan.ctx, terrain, nearest.source, plan.here);
      liftCellByGood.set(goodType, lift);
    }
    if (delivers(terrain.xOf(lift), terrain.yOf(lift))) return nearest;
    if (!confined.anySource(owner, plan.jobType, site, goodType)) return null;
    return materialSource(plan, goodType, (cell) => !delivers(terrain.xOf(cell), terrain.yOf(cell)));
  };
  const resolve = (site: Entity): FetchableMaterial | null => {
    const cached = bySite.get(site);
    if (cached !== undefined || bySite.has(site)) return cached ?? null;
    let needs = needsBySite.get(site);
    if (needs === undefined) {
      needs = neededConstructionGoods(plan.world, plan.ctx, site, plan.supply);
      needsBySite.set(site, needs);
    }
    const fetch = fetchableMaterial(spacing, site, needs, (goodType) => deliveringSourceFor(site, goodType));
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
    canSource: (goodType) => sourceFor(goodType) !== null,
  };
}

function startMaterialFetch(plan: PlannerContext, site: Entity, fetch: FetchableMaterial): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  const settler = plan;
  plan.supply.stampSupplyRun(e, { site, goodType: fetch.goodType, amount: fetch.amount });
  plan.supply.stampPickupClaim(e, { source: fetch.source, goodType: fetch.goodType, amount: fetch.amount });
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
  for (const need of needs) {
    const source = sourceFor(need.goodType);
    if (source === null) continue;
    const amount = Math.min(need.amount, source.available, CARRY_CAPACITY);
    if (amount <= 0) continue;
    // A site with no legal perimeter cell cannot take a delivery, so nothing is fetched for it. Asked after
    // the memoized source, since an idle builder asks every waiting site while no material is in store.
    return spacing.workCells(site).length === 0
      ? null
      : { source: source.source, goodType: need.goodType, amount };
  }
  return null;
}

function shelfSource(plan: PlannerContext, shelf: Entity, goodType: number): MaterialSource | null {
  const stock = accessibleStockAmounts(plan.world, shelf)?.get(goodType) ?? 0;
  const available = stock - plan.supply.reservedAt(shelf, goodType);
  return available > 0 ? { source: shelf, available } : null;
}

type SpotTest = (hx: number, hy: number) => boolean;

interface SiteLift {
  readonly spots: SpotTest | null;
  readonly anyByGood: Map<number, boolean>;
}

/**
 * Where a confined builder can lift a load for a construction site and still carry it there: where the
 * confinement it would carry covers one of the site's work cells. Its own confinement only vouches for the
 * walk to the source, and with two unlinked signpost groups a site may lie in reach of the builder but not
 * of the source, which would turn it back at every pickup. Shared by every builder of one seat and trade
 * for one planner pass, since the answers read only the site, the signpost network and the stores.
 */
export class SiteSupplyReach {
  private readonly bySeat = new Map<number, Map<number, Map<Entity, SiteLift>>>();

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    private readonly spacing: PlannerSpacing,
    private readonly targets: TargetCandidates,
  ) {}

  /** The spots a load for `site` can be lifted at, or null when nothing confines `owner`'s `jobType`. */
  liftSpots(owner: number, jobType: number, site: Entity): SpotTest | null {
    return this.lift(owner, jobType, site).spots;
  }

  /** Whether some store of `owner`'s side holding `goodType` may stand at such a spot: false proves that
   *  no source serves the site, so the caller skips a ring sweep of the builder's whole reach. */
  anySource(owner: number, jobType: number, site: Entity, goodType: number): boolean {
    const lift = this.lift(owner, jobType, site);
    let any = lift.anyByGood.get(goodType);
    if (any === undefined) {
      const band = this.targets.bands.holding(goodType);
      const near = this.spotsReaching(owner, jobType, site, band.filedSlack);
      any = near === null || band.anyFiledIn(near, sameSideAs(this.world, owner));
      lift.anyByGood.set(goodType, any);
    }
    return any;
  }

  private lift(owner: number, jobType: number, site: Entity): SiteLift {
    let byJob = this.bySeat.get(owner);
    if (byJob === undefined) {
      byJob = new Map();
      this.bySeat.set(owner, byJob);
    }
    let bySite = byJob.get(jobType);
    if (bySite === undefined) {
      bySite = new Map();
      byJob.set(jobType, bySite);
    }
    let lift = bySite.get(site);
    if (lift === undefined) {
      lift = { spots: this.spotsReaching(owner, jobType, site, 0), anyByGood: new Map() };
      bySite.set(site, lift);
    }
    return lift;
  }

  private spotsReaching(owner: number, jobType: number, site: Entity, slack: number): SpotTest | null {
    const { world, ctx, terrain } = this;
    return spotsReaching(world, ctx.content, terrain, jobType, owner, this.spacing.workCells(site), slack);
  }
}

/** The nearest store holding `goodType` within the fetcher's reach, passing over the cells `rejects`
 *  names. */
function materialSource(
  plan: PlannerContext,
  goodType: number,
  rejects?: (cell: NodeId) => boolean,
): MaterialSource | null {
  const { world, ctx, entity: e, here, targets } = plan;
  const band = targets.bands.holding(goodType);
  if (!band.hasCandidates()) return null;
  const failed = unreachableGoalVeto(world, ctx, e);
  const avoid =
    rejects === undefined || failed === undefined
      ? (rejects ?? failed)
      : (cell: NodeId) => failed(cell) || rejects(cell);
  const source = nearestStoreHolding(
    targets.bands,
    world,
    here,
    goodType,
    plan.owner,
    plan.supply,
    plan.limit ?? undefined,
    avoid,
  );
  if (source === null) return null;
  const stock = accessibleStockAmounts(world, source)?.get(goodType) ?? 0;
  const available = stock - plan.supply.reservedAt(source, goodType);
  return available > 0 ? { source, available } : null;
}
