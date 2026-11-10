import { CARRY_CAPACITY } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { type NavigationLimit, spotsReaching } from '../../../signposts/index.js';
import { neededConstructionGoods } from '../../../stores/index.js';
import { atOrWalk, startPickup } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
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
    /** Sources no load may be lifted from, by their interaction cell. */
    rejectSource?: ((cell: NodeId) => boolean) | undefined;
    /** Search every store of the owner's side, past the signpost and goods-search gates: the probe for
     *  work the signposts alone keep from the builder, never a fetch. */
    anywhere?: true | undefined;
  } = {},
): {
  has(site: Entity): boolean;
  fetch(site: Entity): boolean;
  /** Whether a source holds `goodType` for this fetcher, the precondition of every `has` a need of it passes. */
  canSource(goodType: number): boolean;
  /** The source `fetch(site)` would lift from, or null when `has(site)` is false. */
  sourceOf(site: Entity): Entity | null;
} {
  const bySite = new Map<Entity, FetchableMaterial | null>();
  const needsBySite = new Map<
    Entity,
    ReadonlyArray<{ readonly goodType: number; readonly amount: number }>
  >();
  const sourceByGood = new Map<number, MaterialSource | null>();
  const { ownShelf, confined, rejectSource, anywhere } = options;
  const sourceFor = (goodType: number): MaterialSource | null => {
    const cached = sourceByGood.get(goodType);
    if (cached !== undefined || sourceByGood.has(goodType)) return cached ?? null;
    const source =
      (ownShelf === undefined ? null : shelfSource(plan, ownShelf, goodType)) ??
      materialSource(plan, goodType, rejectSource, anywhere);
    sourceByGood.set(goodType, source);
    return source;
  };
  // The nearest source serves every site it can deliver to; a site out of its reach takes the nearest of
  // the sources that can, which only a split signpost network ever asks for. Those sources are ranked once
  // per good, so a builder weighing many such sites scans the stores in its reach once, not per site.
  // Made on first use: only a site out of its nearest source's reach asks either.
  let liftCellByGood: Map<number, NodeId> | undefined;
  let rankedByGood: Map<number, readonly NearestByCell[]> | undefined;
  const rankedSources = (goodType: number, owner: number): readonly NearestByCell[] => {
    rankedByGood ??= new Map();
    let ranked = rankedByGood.get(goodType);
    if (ranked === undefined) {
      ranked = storesHoldingRanked(
        plan.targets.bands,
        plan.world,
        plan.here,
        goodType,
        owner,
        plan.supply,
        plan.limit ?? undefined,
        fetcherAvoid(plan, rejectSource),
      );
      rankedByGood.set(goodType, ranked);
    }
    return ranked;
  };
  const deliveringSourceFor = (site: Entity, goodType: number): MaterialSource | null => {
    const nearest = sourceFor(goodType);
    const { owner, terrain } = plan;
    if (nearest === null || confined === undefined || plan.limit === null || owner === undefined)
      return nearest;
    if (confined.liftSpots(owner, plan.jobType, site) === null) return nearest;
    liftCellByGood ??= new Map();
    let lift = liftCellByGood.get(goodType);
    if (lift === undefined) {
      lift = interactionCell(plan.world, plan.ctx, terrain, nearest.source, plan.here);
      liftCellByGood.set(goodType, lift);
    }
    const lifts = (cell: NodeId): boolean => confined.liftsAt(owner, plan.jobType, site, cell);
    if (lifts(lift)) return nearest;
    if (!confined.anySource(owner, plan.jobType, site, goodType, plan.limit)) return null;
    // Only a store filed near the site can lift for it, and that set is far cheaper to ask than the spots.
    const near = confined.storesNear(owner, plan.jobType, site, goodType);
    const source = firstUnvetoed(
      rankedSources(goodType, owner),
      plan.here,
      (cell, store) => near?.stores.has(store) === false || !lifts(cell),
    );
    return source === null ? null : lendingSource(plan, source.entity, goodType);
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
    sourceOf: (site) => resolve(site)?.source ?? null,
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
      lifts = lift.spots(this.terrain.xOf(cell), this.terrain.yOf(cell));
      lift.liftsByCell.set(cell, lifts);
    }
    return lifts;
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
