import { HarvestedBy, Position, Resource, Stockpile } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { positionedStanceCells, resourceStanceCells } from '../../footprint/index.js';
import { resourceApproachCells } from '../../footprint/interaction.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { rankFromSpot } from '../../signposts/index.js';
import { goodsSearchLimitAt } from '../../signposts/reach.js';
import { manhattan } from '../../spatial/metric.js';
import {
  anyHarvestAtomicPresent,
  forEachResourceNear,
  resourceBoxHoldsAll,
  resourcesNearNode,
} from '../../spatial/resources.js';
import {
  leastRankLength,
  type RankFrom,
  rankLength,
  rankOrigin,
  rankSweepRadius,
  rankWalk,
} from '../../spatial/walk-rank.js';
import { lowestStockedGood } from '../../stores/index.js';
import type { PlannerContext } from '../planner/context.js';
import { type CellMatch, type NearestByCell, nearestByCell, precedes } from './cell-index.js';
import {
  collectorStanceGates,
  inWorkBound,
  nearestEligibleStance,
  type WorkBound,
  workBoundDistance,
} from './resource-stances.js';
import { unclaimedGoodsAt } from './stores/stock.js';
import { jobAtomics } from './workplaces.js';

export type HarvestSearchContext = Pick<
  PlannerContext,
  'world' | 'ctx' | 'terrain' | 'entity' | 'here' | 'limit' | 'jobType'
> & {
  readonly targets: Pick<PlannerContext['targets'], 'resources'>;
};

/**
 * The nearest {@link Resource} this settler may harvest, by {@link rankLength} from `opts.rank` with an
 * ascending-cell-id tie-break, or null when none qualifies. The stance at a resource is the one nearest
 * the settler, whatever the resources are ranked from.
 *
 * Approximation: a deposit a building was legally placed over is left un-mined when its work cell lands
 * on the buried anchor, and mined from the side when it does not.
 */
export function nearestHarvestableFor(
  plan: HarvestSearchContext,
  opts: {
    /** What the resources are ranked from: the settler's own spot by distance unless given, as its walk
     *  ({@link rankFromSpot}) or as a flag, so a flag-bound gatherer sweeps outward from its flag rather
     *  than from wherever it stands. */
    readonly rank?: RankFrom | undefined;
    /** Bound the scan to this circle, whatever it is ranked from. */
    readonly bound?: WorkBound | undefined;
    readonly goodFilter?: ReadonlySet<number> | undefined;
    /** Resource nodes already claimed this tick, so one node is dug by one settler at a time. */
    readonly exclude?: ReadonlySet<Entity>;
    /** A node reserved to another settler across ticks, rejected even though this settler's trade
     *  could work it. */
    readonly reserved?: ((node: Entity) => boolean) | undefined;
    /** The settler's own per-node gate, such as its production counters; a node it rejects is skipped. */
    readonly admits?: ((node: Entity) => boolean) | undefined;
    /** Selected-worker diagnostics cap the candidate list and report incomplete searches explicitly. */
    readonly candidates?: readonly Entity[];
    readonly diagnostic?: { eligibleInArea: boolean };
  } = {},
): { entity: Entity; cell: NodeId; dist: number } | null {
  const { world, ctx, terrain, here, targets } = plan;
  const settler = plan;
  const { bound, goodFilter, exclude, reserved, admits } = opts;
  const gate = plan.limit ?? undefined; // the settler's signpost confinement
  const allowed = jobAtomics(ctx, settler.jobType);
  // Dormancy gate: when the job's atomics intersect no harvest atomic present on any standing resource,
  // every candidate would fail the `allowed.has` check below, so the whole scan is provably null. The
  // probe set comes from the actual resources, so a node carrying an out-of-content atomic still gates.
  if (!anyHarvestAtomicPresent(world, allowed)) return null;
  const rank = opts.rank ?? here;
  const origin = rankOrigin(rank);
  // A stance is walked to from where the settler stands.
  const stanceRank = origin === here ? rank : rankFromSpot(plan.limit, here);
  const maxWorkOffset = contentIndex(ctx.content).maxResourceWorkOffset;
  // A work cell lies at most `maxWorkOffset` Manhattan nodes from its anchor, so an anchor farther than
  // this from the bound's centre has a work cell outside the radius.
  const anchorReach = bound === undefined ? 0 : bound.radius + maxWorkOffset;
  const boundX = bound === undefined ? 0 : terrain.xOf(bound.center);
  const boundY = bound === undefined ? 0 : terrain.yOf(bound.center);
  // A bounded scan reads only the resources of the job's atomics whose anchor lies in the bound's box,
  // widened by the content's max work-cell offset so every node whose work cell could pass the radius
  // test is included. A confined roaming scan reads the region box around the allowed area, which covers
  // every anchor whose work cell could pass the gate; an allowed box spanning most of the map is searched
  // in growing boxes around the origin instead, as an unconfined one is. Each is a superset of the
  // candidates that can win, ranked by the same total order, so every source picks the identical winner.
  let box: { readonly x: number; readonly y: number; readonly reach: number } | undefined;
  if (bound !== undefined) {
    box = { x: boundX, y: boundY, reach: anchorReach };
  } else if (gate !== undefined) {
    const b = gate.bounds;
    const boxW = Math.min(b.maxX, terrain.width - 1) - Math.max(b.minX, 0) + 1;
    const boxH = Math.min(b.maxY, terrain.height - 1) - Math.max(b.minY, 0) + 1;
    if (boxW * boxH * 2 < terrain.width * terrain.height) {
      const cx = Math.floor((b.minX + b.maxX) / 2);
      const cy = Math.floor((b.minY + b.maxY) / 2);
      const half = Math.max(cx - b.minX, b.maxX - cx, cy - b.minY, b.maxY - cy);
      box = { x: cx, y: cy, reach: half + maxWorkOffset };
    }
  }
  // Built on the first candidate that reaches the stance check, so a scan nothing qualifies for builds none.
  let passes: ((cell: NodeId) => boolean) | undefined;
  const subject = needSubjectOf(world, plan.entity);
  // The XP gate depends only on the good, so it is resolved once per good per scan.
  let meetsNeedByGood: Map<number, boolean> | undefined;
  /** Whether an anchor at `(hx, hy)` may have a work cell inside the radius; one that cannot is never
   *  resolved. */
  const anchorInBound = (hx: number, hy: number): boolean =>
    bound === undefined || workBoundDistance(terrain, bound, hx, hy) <= anchorReach;
  // Ranked from `origin`, while the interaction cell still resolves from `here`, the route start. Only
  // when the two coincide does a stance past the best length so far lose for certain, and is the stance's
  // length the candidate's.
  const resolve = (e: Entity, cap?: number): HarvestMatch<null> | null => {
    if (exclude?.has(e)) return null; // a colleague already digs this node
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) return null;
    if (goodFilter !== undefined && !goodFilter.has(res.goodType)) return null; // not a good the caller forages for
    if (!allowed.has(res.harvestAtomic)) return null; // data-driven gate: job must permit this atomic
    // Probed behind the atomic gate, so the rule only ever costs a lookup on the trade's own nodes.
    if (reserved?.(e) === true) return null;
    if (admits?.(e) === false) return null;
    // XP gate: this settler must have cleared the harvested good's `needforgood` thresholds.
    meetsNeedByGood ??= new Map();
    let meetsNeed = meetsNeedByGood.get(res.goodType);
    if (meetsNeed === undefined) {
      meetsNeed = settlerMeetsNeed(world, ctx, subject, 'good', res.goodType);
      meetsNeedByGood.set(res.goodType, meetsNeed);
    }
    if (!meetsNeed) return null;
    const stances = resourceStanceCells(world, ctx, terrain, e);
    if (opts.diagnostic !== undefined) {
      for (const stance of resourceApproachCells(world, terrain, e)) {
        if (
          stance === here ||
          ((bound === undefined || inWorkBound(terrain, bound, stance)) &&
            (gate === undefined || gate.allowsNode(stance)))
        )
          opts.diagnostic.eligibleInArea = true;
      }
    }
    passes ??= collectorStanceGates(plan, bound);
    const ranked = stanceRank === rank;
    const stance = nearestEligibleStance(terrain, stanceRank, stances, passes, ranked ? cap : undefined);
    if (stance === undefined) return null;
    return { cell: stance.cell, payload: null, length: ranked ? stance.length : undefined };
  };
  let best: NearestByCell<null> | null;
  if (opts.diagnostic !== undefined) {
    // A diagnostic reports on every candidate, so it walks the whole ascending-id list.
    const scanned =
      opts.candidates ??
      (box === undefined ? targets.resources : resourcesNearNode(world, box.x, box.y, box.reach, allowed));
    const inBound = (e: Entity): CellMatch<null> | null => {
      const p = world.tryGet(e, Position);
      if (p === undefined || !anchorInBound(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y)))
        return null;
      return resolve(e);
    };
    best = nearestByCell(terrain, scanned, rank, inBound);
  } else {
    const anchors = new AnchorRanking(terrain.xOf(origin), terrain.yOf(origin), maxWorkOffset, anchorInBound);
    if (opts.candidates !== undefined) {
      best = anchors.addList(world, opts.candidates).fold(terrain, rank, null, resolve);
    } else if (box !== undefined) {
      forEachResourceNear(world, box.x, box.y, box.reach, anchors.add, allowed);
      best = anchors.fold(terrain, rank, null, resolve);
    } else {
      best = nearestInGrowingBoxes(world, terrain, rank, allowed, anchors, resolve);
    }
  }
  // No same-side gate: a standing Resource is never Owner-stamped, so the test would always pass.
  return best === null ? null : { entity: best.entity, cell: best.cell, dist: best.distance };
}

/**
 * The nearest {@link GroundDrop} pile across `lists` whose good `pick` selects, with its rank
 * length. Every `targets.groundDrops` entry already carries GroundDrop+Stockpile+Position, so the scan
 * re-checks no markers. The good `pick` returns then faces the work-cell reachability, signpost and
 * sealed-pocket gates. Piles are resolved nearest node first under the scan's total order, so a pile
 * listed twice is harmless and the pick matches one scan over the lists' sorted union.
 */
function nearestDropFor(
  plan: PlannerContext,
  lists: readonly (readonly Entity[])[],
  pick: (e: Entity) => number | null,
  within?: WorkBound,
): { pile: Entity; goodType: number; cell: NodeId; dist: number } | null {
  const { world, ctx, terrain, here } = plan;
  const rank = rankFromSpot(plan.limit, here);
  let passes: ((cell: NodeId) => boolean) | undefined;
  // Ranked from `here` as the stance is, so a stance past the best length so far cannot win.
  const resolve = (e: Entity, cap?: number): HarvestMatch<number> | null => {
    const good = pick(e);
    if (good === null) return null;
    if (passes === undefined) {
      const stance = collectorStanceGates(plan, within);
      // Asked on the first picked pile, so a scan whose piles hold nothing it wants asks none.
      const goods = goodsSearchLimitAt(
        world,
        ctx.content,
        terrain,
        plan.owner,
        terrain.xOf(here),
        terrain.yOf(here),
      );
      passes = (node) => stance(node) && (goods === null || goods.allowsNode(node));
    }
    const stance = nearestEligibleStance(
      terrain,
      rank,
      positionedStanceCells(world, ctx, terrain, e),
      passes,
      cap,
    );
    if (stance === undefined) return null;
    return { cell: stance.cell, payload: good, length: stance.length };
  };
  // A pile's stance is the node itself, a free neighbour, or the work cell of a resource standing on it,
  // so a pile farther than that offset past `within` has no stance inside it and is never resolved.
  const maxWorkOffset = contentIndex(ctx.content).maxResourceWorkOffset;
  const anchorReach = within === undefined ? 0 : within.radius + maxWorkOffset;
  const anchors = new AnchorRanking(
    terrain.xOf(here),
    terrain.yOf(here),
    maxWorkOffset,
    within === undefined
      ? ADMIT_ANY_ANCHOR
      : (hx, hy) => workBoundDistance(terrain, within, hx, hy) <= anchorReach,
  );
  for (let i = 0; i < lists.length; i++) {
    const piles = lists[i];
    if (piles !== undefined) anchors.addList(world, piles);
  }
  const best = anchors.fold(terrain, rank, null, resolve);
  return best === null
    ? null
    : { pile: best.entity, goodType: best.payload, cell: best.cell, dist: best.distance };
}

/**
 * The nearest ground drop a felling collector should carry off, with its rank length, or null.
 * Scoped to keep it the collector's own-trade loop rather than a general porter drive: `GroundDrop` piles
 * only, never a delivery flag or a boat hull, and only a good the settler's job may harvest. Collecting
 * an already-dropped good applies no `needforgood` XP gate, since carrying a trunk is hauling.
 * `within` bounds which piles count without moving the ranking, which stays on the settler. A drop whose
 * units are all claimed by settlers walking to it is left to them.
 */
export function nearestCollectablePileFor(
  plan: PlannerContext,
  opts: {
    readonly goodFilter?: ReadonlySet<number> | undefined;
    readonly within?: WorkBound | undefined;
  } = {},
): { pile: Entity; goodType: number; cell: NodeId; dist: number } | null {
  const { world, ctx, targets } = plan;
  const { goodFilter } = opts;
  const allowed = jobAtomics(ctx, plan.jobType);
  // Only piles of a good this trade harvests (and the caller forages for) are visited at all.
  let piles: (readonly Entity[])[] | undefined;
  const { harvestAtomicByGood } = targets;
  for (const good of harvestAtomicByGood.keys()) {
    const harvestAtomic = harvestAtomicByGood.get(good);
    if (harvestAtomic === undefined || !allowed.has(harvestAtomic)) continue;
    if (goodFilter !== undefined && !goodFilter.has(good)) continue;
    const ofGood = targets.groundDropsByGood.get(good);
    if (ofGood === undefined || ofGood.length === 0) continue;
    piles ??= [];
    piles.push(ofGood);
  }
  if (piles === undefined) return null;
  return nearestDropFor(
    plan,
    piles,
    (e) => {
      const good = lowestStockedGood(
        world.get(e, Stockpile),
        unclaimedGoodsAt(world, plan.ctx, plan.supply, e),
      );
      if (good === null) return null; // an emptied drop, about to be reaped, or one walkers claimed whole
      if (goodFilter !== undefined && !goodFilter.has(good)) return null; // not a good the caller forages for
      const harvestAtomic = targets.harvestAtomicByGood.get(good);
      if (harvestAtomic === undefined || !allowed.has(harvestAtomic)) return null; // not this job's trade
      return good;
    },
    opts.within,
  );
}

/**
 * The nearest ground drop whose {@link HarvestedBy} mark names this gatherer, with its rank length, or
 * null. Unlike {@link nearestCollectablePileFor}'s trade-wide scan it ignores every pile
 * the gatherer did not make: it carries only what it dug, unless a porter already walks to lift it.
 */
export function nearestOwnDropFor(
  plan: PlannerContext,
): { pile: Entity; goodType: number; cell: NodeId; dist: number } | null {
  const { world, entity: gatherer, targets } = plan;
  const own = targets.ownDropsOf(gatherer);
  if (own === undefined) return null;
  return nearestDropFor(plan, [own], (e) => {
    const mark = world.tryGet(e, HarvestedBy);
    if (mark === undefined || mark.by !== gatherer) return null; // not this gatherer's own drop
    const good = lowestStockedGood(
      world.get(e, Stockpile),
      unclaimedGoodsAt(world, plan.ctx, plan.supply, e),
    );
    return good; // null when emptied, about to be reaped, or claimed whole by a porter
  });
}

/** A resolved candidate, with the length it ranks at when its stance was ranked as the candidates are. */
interface HarvestMatch<P> extends CellMatch<P> {
  readonly length: number | undefined;
}

/** Candidate sort keys: an anchor's lower-bound distance in the high part, the entity id in the low. */
let anchorKeys = new Float64Array(0);
const ENTITY_KEY_SPAN = 2 ** 31;
const INITIAL_ANCHOR_KEYS = 64;

/** Half-width in nodes of the first box {@link nearestInGrowingBoxes} searches, doubled per miss. */
const FIRST_SEARCH_BOX_REACH = 32;

/**
 * {@link nearestByCell}'s winner over candidates whose anchor `anchorAdmits`, resolved nearest anchor
 * first and stopping once no unresolved anchor can come nearer. A work cell lies at most `maxWorkOffset`
 * Manhattan nodes from its anchor, so the anchor distance less that offset bounds the candidate's
 * distance from below. Ties keep the scan's `(distance, cell, entity)` order, so the winner does not
 * depend on the order candidates are added in. Keys live in a module scratch: one ranking at a time.
 */
class AnchorRanking {
  private count = 0;

  constructor(
    private readonly ox: number,
    private readonly oy: number,
    readonly maxWorkOffset: number,
    private readonly anchorAdmits: (hx: number, hy: number) => boolean,
  ) {}

  readonly add = (e: Entity, hx: number, hy: number): void => {
    if (!this.anchorAdmits(hx, hy)) return;
    if (this.count === anchorKeys.length) {
      const grown = new Float64Array(Math.max(INITIAL_ANCHOR_KEYS, anchorKeys.length * 2));
      grown.set(anchorKeys);
      anchorKeys = grown;
    }
    const lowerBound = Math.max(0, Math.abs(hx - this.ox) + Math.abs(hy - this.oy) - this.maxWorkOffset);
    anchorKeys[this.count++] = lowerBound * ENTITY_KEY_SPAN + e;
  };

  /** Add the positioned members of `list`. */
  addList(world: World, list: readonly Entity[]): this {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const p = e === undefined ? undefined : world.tryGet(e, Position);
      if (e !== undefined && p !== undefined)
        this.add(e, nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
    }
    return this;
  }

  /** Fold the added candidates into `best`, ranked from `rank`, the node the ranking was made around or a
   *  walk from it, and forget them. `resolve` is told the best length so far, past which its candidate
   *  cannot win. */
  fold<P>(
    terrain: TerrainGraph,
    rank: RankFrom,
    best: NearestByCell<P> | null,
    resolve: (e: Entity, cap?: number) => HarvestMatch<P> | null,
  ): NearestByCell<P> | null {
    const origin = rankOrigin(rank);
    const walk = rankWalk(rank);
    const keys = anchorKeys.subarray(0, this.count).sort();
    this.count = 0;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] ?? 0;
      const e = (key % ENTITY_KEY_SPAN) as Entity;
      if (best !== null && leastRankLength(walk, (key - e) / ENTITY_KEY_SPAN) > best.distance) break;
      const match = resolve(e, best?.distance);
      if (match === null) continue;
      const distance =
        match.length ?? rankLength(walk, match.cell, manhattan(terrain, origin, match.cell), best?.distance);
      if (best === null || precedes(distance, match.cell, e, best))
        best = { entity: e, cell: match.cell, distance, payload: match.payload };
    }
    return best;
  }
}

const ADMIT_ANY_ANCHOR = (): boolean => true;

/**
 * The {@link AnchorRanking} winner over every resource of the `atomics`, read in boxes around `rank`'s node
 * that double until one holds every resource or the winner's distance: an anchor outside a box of
 * half-width `reach` lies more than `reach` Manhattan nodes away, so no candidate past it comes nearer
 * than `reach` less the work-cell offset.
 */
function nearestInGrowingBoxes(
  world: World,
  terrain: TerrainGraph,
  rank: RankFrom,
  atomics: ReadonlySet<number>,
  anchors: AnchorRanking,
  resolve: (e: Entity, cap?: number) => HarvestMatch<null> | null,
): NearestByCell<null> | null {
  const origin = rankOrigin(rank);
  const walk = rankWalk(rank);
  const ox = terrain.xOf(origin);
  const oy = terrain.yOf(origin);
  const maxWorkOffset = anchors.maxWorkOffset;
  let best: NearestByCell<null> | null = null;
  let inner: number | undefined;
  for (let reach = FIRST_SEARCH_BOX_REACH; ; reach *= 2) {
    forEachResourceNear(world, ox, oy, reach, anchors.add, atomics, inner);
    best = anchors.fold(terrain, rank, best, resolve);
    if (best !== null && reach - maxWorkOffset >= rankSweepRadius(walk, best.distance)) return best;
    if (resourceBoxHoldsAll(world, ox, oy, reach)) return best;
    inner = reach;
  }
}
