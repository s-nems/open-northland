import { CARRY_CAPACITY, type GoodsLine } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { jobLimitAt, type NavigationLimit, spotsReaching } from '../../../signposts/index.js';
import { neededConstructionGoods } from '../../../stores/index.js';
import { atOrWalk, startPickup } from '../../atomics/start.js';
import { type PlannerContext, planRank } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { FILED_STRIDE } from '../../targets/cell-index.js';
import {
  firstUnvetoed,
  interactionCell,
  type NearestByCell,
  nearestStoreHolding,
  nearestStoreHoldingAnywhere,
  storesHoldingRanked,
  type TargetCandidates,
  unclaimedStockOf,
} from '../../targets/index.js';
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
  return new ConstructionMaterialResolver(plan, spacing, { ownShelf }).fetch(site);
}

/** How a {@link ConstructionMaterialResolver} sources its loads. */
export interface MaterialResolverOptions {
  readonly ownShelf?: Entity | undefined;
  /** Only fetch from a source the site lies in reach of: for a site the builder picked within its own
   *  confinement. A site it holds by order or binding takes its load past the confinement, as the
   *  delivery's bound sink does. */
  readonly confined?: SiteSupplyReach | undefined;
  /** Sources no load may be lifted from, by their interaction cell. */
  readonly rejectSource?: ((cell: NodeId) => boolean) | undefined;
  /** Search every store of the owner's side, past the signpost and goods-search gates: the probe for
   *  work the signposts alone keep from the builder, never a fetch. */
  readonly anywhere?: true | undefined;
}

const NO_OPTIONS: MaterialResolverOptions = {};

/** A one-builder resolver: site selection shares one source lookup per good, then consumes the chosen
 * site's cached payload. Reachability and failed-goal state are constant for this resolver's lifetime.
 * Its memos are made on first use, since most builders ask few sites or none. */
export class ConstructionMaterialResolver {
  private bySite: Map<Entity, FetchableMaterial | null> | undefined;
  private sourceByGood: Map<number, MaterialSource | null> | undefined;
  // The nearest source serves every site it can deliver to; a site out of its reach takes the nearest of
  // the sources that can, which only a split signpost network ever asks for. Those sources are ranked once
  // per good, so a builder weighing many such sites scans the stores in its reach once, not per site.
  private liftCellByGood: Map<number, NodeId> | undefined;
  private rankedByGood: Map<number, readonly NearestByCell[]> | undefined;

  constructor(
    private readonly plan: PlannerContext,
    private readonly spacing: PlannerSpacing,
    private readonly options: MaterialResolverOptions = NO_OPTIONS,
  ) {}

  has(site: Entity): boolean {
    return this.resolve(site) !== null;
  }

  fetch(site: Entity): boolean {
    const fetch = this.resolve(site);
    if (fetch === null) return false;
    startMaterialFetch(this.plan, site, fetch);
    return true;
  }

  /** Whether a source holds `goodType` for this fetcher, the precondition of every `has` a need of it
   *  passes. Bound, since the site claims take it as a predicate. */
  readonly canSource = (goodType: number): boolean => this.sourceFor(goodType) !== null;

  private sourceFor(goodType: number): MaterialSource | null {
    this.sourceByGood ??= new Map();
    const cached = this.sourceByGood.get(goodType);
    if (cached !== undefined || this.sourceByGood.has(goodType)) return cached ?? null;
    const { plan } = this;
    const { ownShelf, rejectSource, anywhere } = this.options;
    const source =
      (ownShelf === undefined ? null : shelfSource(plan, ownShelf, goodType)) ??
      materialSource(plan, goodType, rejectSource, anywhere);
    this.sourceByGood.set(goodType, source);
    return source;
  }

  private rankedSources(goodType: number, owner: number): readonly NearestByCell[] {
    this.rankedByGood ??= new Map();
    let ranked = this.rankedByGood.get(goodType);
    if (ranked === undefined) {
      const { plan } = this;
      ranked = storesHoldingRanked(
        plan.targets.bands,
        plan.world,
        plan.here,
        planRank(plan),
        goodType,
        owner,
        plan.supply,
        plan.limit ?? undefined,
        fetcherAvoid(plan, this.options.rejectSource),
      );
      this.rankedByGood.set(goodType, ranked);
    }
    return ranked;
  }

  private deliveringSourceFor(site: Entity, goodType: number): MaterialSource | null {
    const nearest = this.sourceFor(goodType);
    const { plan } = this;
    const { confined } = this.options;
    const { owner, terrain } = plan;
    if (nearest === null || confined === undefined || plan.limit === null || owner === undefined)
      return nearest;
    if (confined.liftSpots(owner, plan.jobType, site) === null) return nearest;
    this.liftCellByGood ??= new Map();
    let lift = this.liftCellByGood.get(goodType);
    if (lift === undefined) {
      lift = interactionCell(plan.world, plan.ctx, terrain, nearest.source, plan.here);
      this.liftCellByGood.set(goodType, lift);
    }
    const lifts = (cell: NodeId): boolean => confined.liftsAt(owner, plan.jobType, site, cell);
    if (lifts(lift)) return nearest;
    if (!confined.anySource(owner, plan.jobType, site, goodType, plan.limit)) return null;
    // Only a store filed near the site can lift for it, and that set is far cheaper to ask than the spots.
    const near = confined.storesNear(owner, plan.jobType, site, goodType);
    const source = firstUnvetoed(
      this.rankedSources(goodType, owner),
      plan.here,
      (cell, store) => near?.stores.has(store) === false || !lifts(cell),
    );
    return source === null ? null : lendingSource(plan, source.entity, goodType);
  }

  private resolve(site: Entity): FetchableMaterial | null {
    this.bySite ??= new Map();
    const cached = this.bySite.get(site);
    if (cached !== undefined || this.bySite.has(site)) return cached ?? null;
    const fetch = this.fetchableMaterial(site);
    this.bySite.set(site, fetch);
    return fetch;
  }

  /** Pick without claiming, so site allocation and the claiming drive ask exactly the same question. Tries
   *  the bill in order, so a good with no source never blocks the ones that are available. */
  private fetchableMaterial(site: Entity): FetchableMaterial | null {
    const { plan } = this;
    const needs = neededConstructionGoods(plan.world, plan.ctx, site, plan.supply);
    for (let i = 0; i < needs.length; i++) {
      const need = needs[i] as GoodsLine;
      const source = this.deliveringSourceFor(site, need.goodType);
      if (source === null) continue;
      const amount = Math.min(need.amount, source.available, CARRY_CAPACITY);
      if (amount <= 0) continue;
      // A site with no legal stand cell cannot take a delivery, so nothing is fetched for it. Asked after
      // the memoized source, since an idle builder asks every waiting site while no material is in store.
      return this.spacing.workCells(site).length === 0
        ? null
        : { source: source.source, goodType: need.goodType, amount };
    }
    return null;
  }
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

function shelfSource(plan: PlannerContext, shelf: Entity, goodType: number): MaterialSource | null {
  const available = unclaimedStockOf(plan.world, plan.ctx, plan.supply, shelf, goodType);
  return available > 0 ? { source: shelf, available } : null;
}

type SpotTest = (hx: number, hy: number) => boolean;

/** The stores of one band that may lift a load for a site, filed at its spots widened by the filing slack. */
interface StoresNear {
  readonly stores: ReadonlySet<Entity>;
  /** Their filed nodes, `x, y` per store. */
  readonly nodes: readonly number[];
}

interface SiteLift {
  readonly spots: SpotTest | null;
  /** The spots widened by a band's filing slack, one per slack asked. */
  readonly nearBySlack: Map<number, SpotTest | null>;
  /** {@link SiteSupplyReach.storesNear} by good. */
  readonly storesByGood: Map<number, StoresNear | null>;
  /** {@link spots} by cell asked. */
  readonly liftsByCell: Map<NodeId, boolean>;
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
  /** Each builder's answer to `builderWorkBeyondReach` this pass: its staging and its idle tail both ask. */
  readonly beyondReachByBuilder = new Map<Entity, NodeId | null>();

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

  /** Whether a load lifted at `cell` reaches `site`: {@link liftSpots} at the cell, true when nothing
   *  confines. Kept for the pass, since every builder of the seat asks it of the same few store cells. */
  liftsAt(owner: number, jobType: number, site: Entity, cell: NodeId): boolean {
    const lift = this.lift(owner, jobType, site);
    if (lift.spots === null) return true;
    let lifts = lift.liftsByCell.get(cell);
    if (lifts === undefined) {
      const x = this.terrain.xOf(cell);
      const y = this.terrain.yOf(cell);
      lifts = lift.spots(x, y) && this.walkReaches(owner, jobType, site, x, y);
      lift.liftsByCell.set(cell, lifts);
    }
    return lifts;
  }

  /** Whether the confinement a builder carries standing on `(hx, hy)` allows one of `site`'s work cells:
   *  the lift spots judge by distance, and a river may lie between. */
  private walkReaches(owner: number, jobType: number, site: Entity, hx: number, hy: number): boolean {
    const { world, ctx, terrain } = this;
    const limit = jobLimitAt(world, ctx.content, terrain, jobType, owner, hx, hy);
    return limit === null || this.spacing.workCells(site).some((goal) => limit.allowsNode(goal));
  }

  /** Whether some store of `owner`'s side holding `goodType` may stand at such a spot, and within the
   *  asking builder's own `reach`: false proves that no source serves the site, so the caller skips a
   *  search of the builder's whole reach. The site's stores are shared; the builder's own test is one
   *  distance and coverage read per store among them. */
  anySource(owner: number, jobType: number, site: Entity, goodType: number, reach: NavigationLimit): boolean {
    const near = this.storesNear(owner, jobType, site, goodType);
    if (near === null) return true;
    const slack = this.targets.bands.holding(goodType).filedSlack;
    const { nodes } = near;
    for (let i = 0; i < nodes.length; i += 2) {
      if (reach.mayAllowNear?.(nodes[i] as number, nodes[i + 1] as number, slack) ?? true) return true;
    }
    return false;
  }

  /** The stores of `owner`'s side holding `goodType` filed at `site`'s lift spots widened by the band's
   *  filing slack, since a loose pile is filed up to that far from the cell it is lifted at: a store
   *  outside them never lifts a load for the site. Null when nothing confines `owner`'s `jobType`. */
  storesNear(owner: number, jobType: number, site: Entity, goodType: number): StoresNear | null {
    const lift = this.lift(owner, jobType, site);
    const held = lift.storesByGood.get(goodType);
    if (held !== undefined) return held;
    const band = this.targets.bands.holding(goodType);
    const slack = band.filedSlack;
    let spots = lift.nearBySlack.get(slack);
    if (spots === undefined) {
      spots = this.spotsReaching(owner, jobType, site, slack);
      lift.nearBySlack.set(slack, spots);
    }
    let near: StoresNear | null = null;
    if (spots !== null) {
      const stores = new Set<Entity>();
      const nodes: number[] = [];
      const filed = band.filedOnSide(owner);
      for (let i = 0; i < filed.length; i += FILED_STRIDE) {
        const x = filed[i + 1] as number;
        const y = filed[i + 2] as number;
        if (!spots(x, y)) continue;
        stores.add(filed[i] as Entity);
        nodes.push(x, y);
      }
      near = { stores, nodes };
    }
    lift.storesByGood.set(goodType, near);
    return near;
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
      lift = {
        spots: this.spotsReaching(owner, jobType, site, 0),
        nearBySlack: new Map(),
        storesByGood: new Map(),
        liftsByCell: new Map(),
      };
      bySite.set(site, lift);
    }
    return lift;
  }

  private spotsReaching(owner: number, jobType: number, site: Entity, slack: number): SpotTest | null {
    const { world, ctx, terrain } = this;
    return spotsReaching(world, ctx.content, terrain, jobType, owner, this.spacing.workCells(site), slack);
  }
}

/** The nearest store holding `goodType` within the fetcher's reach, or `anywhere` on its side, passing
 *  over the cells `rejects` names. */
function materialSource(
  plan: PlannerContext,
  goodType: number,
  rejects?: (cell: NodeId) => boolean,
  anywhere?: true,
): MaterialSource | null {
  const { world, here, targets } = plan;
  const band = targets.bands.holding(goodType);
  if (!band.hasCandidates()) return null;
  const avoid = fetcherAvoid(plan, rejects);
  const source = anywhere
    ? nearestStoreHoldingAnywhere(targets.bands, world, here, goodType, plan.owner, plan.supply, avoid)
    : nearestStoreHolding(
        targets.bands,
        world,
        here,
        planRank(plan),
        goodType,
        plan.owner,
        plan.supply,
        plan.limit ?? undefined,
        avoid,
      );
  return source === null ? null : lendingSource(plan, source, goodType);
}

/** `source` with the units of `goodType` it lends this fetcher, or null for none. */
function lendingSource(plan: PlannerContext, source: Entity, goodType: number): MaterialSource | null {
  const available = unclaimedStockOf(plan.world, plan.ctx, plan.supply, source, goodType);
  return available > 0 ? { source, available } : null;
}

/** The cells a fetcher's source search passes over: its failed goals and those `rejects` names. */
function fetcherAvoid(
  plan: PlannerContext,
  rejects: ((cell: NodeId) => boolean) | undefined,
): ((cell: NodeId) => boolean) | undefined {
  const failed = unreachableGoalVeto(plan.world, plan.ctx, plan.entity);
  return rejects === undefined || failed === undefined
    ? (rejects ?? failed)
    : (cell: NodeId) => failed(cell) || rejects(cell);
}
