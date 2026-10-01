import { HarvestedBy, Position, Resource, Stockpile } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { positionedStanceCells, resourceStanceCells } from '../../footprint/index.js';
import { resourceApproachCells } from '../../footprint/interaction.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { manhattan } from '../../spatial/metric.js';
import { anyHarvestAtomicPresent, resourcesNearNode } from '../../spatial/resources.js';
import { lowestStockedGood } from '../../stores/index.js';
import type { PlannerContext } from '../planner/context.js';
import { type CellMatch, type NearestByCell, nearerOf, nearestByCell } from './cell-index.js';
import { collectorStanceGates, nearestEligibleStance } from './resource-stances.js';
import { jobAtomics } from './workplaces.js';

export type HarvestSearchContext = Pick<
  PlannerContext,
  'world' | 'ctx' | 'terrain' | 'entity' | 'here' | 'limit' | 'jobType'
> & {
  readonly targets: Pick<PlannerContext['targets'], 'resources'>;
};

/**
 * The nearest {@link Resource} this settler may harvest, by Manhattan distance with an ascending-cell-id
 * tie-break, or null when none qualifies.
 *
 * Approximation: a deposit a building was legally placed over is left un-mined when its work cell lands
 * on the buried anchor, and mined from the side when it does not.
 */
export function nearestHarvestableFor(
  plan: HarvestSearchContext,
  opts: {
    /** Bound the scan to this circle and rank from its centre, so a flag-bound gatherer sweeps outward
     *  from its flag rather than from wherever it stands. */
    readonly area?: { center: NodeId; radius: number };
    /** Bound the scan to this circle but keep the ranking on the settler, for a bound that is a work
     *  area rather than a sweep origin. Pass this or {@link area}, never both. */
    readonly within?: { center: NodeId; radius: number };
    readonly goodFilter?: ReadonlySet<number>;
    /** Resource nodes already claimed this tick, so one node is dug by one settler at a time. */
    readonly exclude?: ReadonlySet<Entity>;
    /** A node reserved to another settler across ticks, rejected even though this settler's trade
     *  could work it. */
    readonly reserved?: (node: Entity) => boolean;
    /** The settler's own per-node gate, such as its production counters; a node it rejects is skipped. */
    readonly admits?: (node: Entity) => boolean;
    /** Selected-worker diagnostics cap the candidate list and report incomplete searches explicitly. */
    readonly candidates?: readonly Entity[];
    readonly diagnostic?: { eligibleInArea: boolean };
  } = {},
): { entity: Entity; cell: NodeId; dist: number } | null {
  const { world, ctx, terrain, here, targets } = plan;
  const settler = plan;
  const { area, within, goodFilter, exclude, reserved, admits } = opts;
  const gate = plan.limit ?? undefined; // the settler's signpost confinement
  const allowed = jobAtomics(ctx, settler.jobType);
  // Dormancy gate: when the job's atomics intersect no harvest atomic present on any standing resource,
  // every candidate would fail the `allowed.has` check below, so the whole scan is provably null. The
  // probe set comes from the actual resources, so a node carrying an out-of-content atomic still gates.
  if (!anyHarvestAtomicPresent(world, allowed)) return null;
  const origin = area?.center ?? here;
  const bound = area ?? within;
  const maxWorkOffset = contentIndex(ctx.content).maxResourceWorkOffset;
  // A work cell lies at most `maxWorkOffset` Manhattan nodes from its anchor, so an anchor farther than
  // this from the bound's centre has a work cell outside the radius.
  const anchorReach = bound === undefined ? 0 : bound.radius + maxWorkOffset;
  const boundX = bound === undefined ? 0 : terrain.coordsOf(bound.center).x;
  const boundY = bound === undefined ? 0 : terrain.coordsOf(bound.center).y;
  // A bounded scan reads only the resources of the job's atomics whose anchor lies in the bound's box,
  // widened by the content's max work-cell offset so every node whose work cell could pass the radius
  // test is included. The same filter/rank loop over an ascending-id superset picks the identical winner.
  let scanned: readonly Entity[] | undefined;
  if (bound !== undefined) {
    scanned = resourcesNearNode(world, boundX, boundY, anchorReach, allowed);
  } else if (gate !== undefined) {
    // A confined roaming scan: the region box around the allowed area covers every anchor whose work
    // cell could pass the gate, the same superset argument as the bounded path. Guarded, because an
    // allowed box spanning most of the map makes the pre-sorted canonical list the cheaper superset.
    const b = gate.bounds;
    const boxW = Math.min(b.maxX, terrain.width - 1) - Math.max(b.minX, 0) + 1;
    const boxH = Math.min(b.maxY, terrain.height - 1) - Math.max(b.minY, 0) + 1;
    if (boxW * boxH * 2 < terrain.width * terrain.height) {
      const cx = Math.floor((b.minX + b.maxX) / 2);
      const cy = Math.floor((b.minY + b.maxY) / 2);
      const half = Math.max(cx - b.minX, b.maxX - cx, cy - b.minY, b.maxY - cy);
      scanned = resourcesNearNode(world, cx, cy, half + maxWorkOffset, allowed);
    }
  }
  if (opts.candidates !== undefined) scanned = opts.candidates;
  scanned ??= targets.resources;
  // Built on the first candidate that reaches the stance check, so a scan nothing qualifies for builds none.
  let passes: ((cell: NodeId) => boolean) | undefined;
  const subject = needSubjectOf(world, plan.entity);
  // The XP gate depends only on the good, so it is resolved once per good per scan.
  let meetsNeedByGood: Map<number, boolean> | undefined;
  // Ranked from `origin`, while the interaction cell still resolves from `here`, the route start.
  const best = nearestByCell(terrain, scanned, origin, (e) => {
    if (exclude?.has(e)) return null; // a colleague already digs this node
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) return null;
    if (goodFilter !== undefined && !goodFilter.has(res.goodType)) return null; // not a good the caller forages for
    const p = world.tryGet(e, Position);
    if (p === undefined) return null;
    if (!allowed.has(res.harvestAtomic)) return null; // data-driven gate: job must permit this atomic
    if (
      bound !== undefined &&
      Math.abs(nodeHxOfPosition(p.x, p.y) - boundX) + Math.abs(nodeHyOfPosition(p.y) - boundY) > anchorReach
    ) {
      return null; // its work cell cannot reach into the radius, so skip resolving it
    }
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
          ((bound === undefined || manhattan(terrain, bound.center, stance) <= bound.radius) &&
            (gate === undefined || gate.allowsNode(stance)))
        )
          opts.diagnostic.eligibleInArea = true;
      }
    }
    passes ??= collectorStanceGates(plan, bound);
    const cell = nearestEligibleStance(plan, stances, passes);
    if (cell === undefined) return null;
    return { cell, payload: null };
  });
  // No same-side gate: a standing Resource is never Owner-stamped, so the test would always pass.
  return best === null ? null : { entity: best.entity, cell: best.cell, dist: best.distance };
}

/**
 * The nearest {@link GroundDrop} pile across `lists` whose good `pick` selects, with its Manhattan
 * distance. Every `targets.groundDrops` entry already carries GroundDrop+Stockpile+Position, so the scan
 * re-checks no markers. The good `pick` returns then faces the work-cell reachability, signpost and
 * sealed-pocket gates. A pile may sit in several lists: each list is ascending-id and the winners merge
 * by the scan's total order, so the pick matches one scan over their sorted union.
 */
function nearestDropFor(
  plan: PlannerContext,
  lists: readonly (readonly Entity[])[],
  pick: (e: Entity) => number | null,
  within?: { center: NodeId; radius: number },
): { pile: Entity; goodType: number; cell: NodeId; dist: number } | null {
  const { world, ctx, terrain, here } = plan;
  let passes: ((cell: NodeId) => boolean) | undefined;
  const resolve = (e: Entity): CellMatch<number> | null => {
    const good = pick(e);
    if (good === null) return null;
    passes ??= collectorStanceGates(plan, within);
    const cell = nearestEligibleStance(plan, positionedStanceCells(world, ctx, terrain, e), passes);
    if (cell === undefined) return null;
    return { cell, payload: good };
  };
  let best: NearestByCell<number> | null = null;
  for (let i = 0; i < lists.length; i++) {
    const piles = lists[i];
    if (piles !== undefined) best = nearerOf(best, nearestByCell(terrain, piles, here, resolve));
  }
  return best === null
    ? null
    : { pile: best.entity, goodType: best.payload, cell: best.cell, dist: best.distance };
}

/**
 * The nearest ground drop a felling collector should carry off, with its Manhattan distance, or null.
 * Scoped to keep it the collector's own-trade loop rather than a general porter drive: `GroundDrop` piles
 * only, never a delivery flag or a boat hull, and only a good the settler's job may harvest. Collecting
 * an already-dropped good applies no `needforgood` XP gate, since carrying a trunk is hauling.
 * `within` bounds which piles count without moving the ranking, which stays on the settler.
 */
export function nearestCollectablePileFor(
  plan: PlannerContext,
  opts: {
    readonly goodFilter?: ReadonlySet<number>;
    readonly within?: { center: NodeId; radius: number };
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
      const good = lowestStockedGood(world.get(e, Stockpile));
      if (good === null) return null; // an emptied drop, about to be reaped
      if (goodFilter !== undefined && !goodFilter.has(good)) return null; // not a good the caller forages for
      const harvestAtomic = targets.harvestAtomicByGood.get(good);
      if (harvestAtomic === undefined || !allowed.has(harvestAtomic)) return null; // not this job's trade
      return good;
    },
    opts.within,
  );
}

/**
 * The nearest ground drop whose {@link HarvestedBy} mark names this gatherer, with its Manhattan
 * distance, or null. Unlike {@link nearestCollectablePileFor}'s trade-wide scan it ignores every pile
 * the gatherer did not make: it carries only what it dug.
 */
export function nearestOwnDropFor(
  plan: PlannerContext,
): { pile: Entity; goodType: number; cell: NodeId; dist: number } | null {
  const { world, entity: gatherer, targets } = plan;
  const own = targets.groundDropsByHarvester.get(gatherer);
  if (own === undefined) return null;
  return nearestDropFor(plan, [own], (e) => {
    const mark = world.tryGet(e, HarvestedBy);
    if (mark === undefined || mark.by !== gatherer) return null; // not this gatherer's own drop
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) return null; // emptied, about to be reaped
    return good;
  });
}
