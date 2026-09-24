import { HarvestedBy, Position, Resource, Stockpile } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { dynamicBlockOverlay, routeRegions } from '../../footprint/index.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { manhattan } from '../../spatial/metric.js';
import { canonicalById } from '../../spatial/nodes.js';
import { resourceHarvestAtomics, resourcesNearNode } from '../../spatial/resources.js';
import { lowestStockedGood } from '../../stores/index.js';
import type { PlannerContext } from '../planner/context.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import { nearestByCell } from './cell-index.js';
import { unreachableWorkCell, type WorkCellGates } from './reachability.js';
import { interactionCell, jobAtomics } from './workplaces.js';

/**
 * The nearest {@link Resource} this settler may harvest, by Manhattan distance with an ascending-cell-id
 * tie-break, or null when none qualifies.
 *
 * Approximation: a deposit a building was legally placed over is left un-mined when its work cell lands
 * on the buried anchor, and mined from the side when it does not.
 */
export function nearestHarvestableFor(
  plan: PlannerContext,
  opts: {
    /** Bound the scan to this circle and rank from its centre, so a flag-bound gatherer sweeps outward
     *  from its flag rather than from wherever it stands. */
    readonly area?: { center: NodeId; radius: number; goodType?: number };
    /** Bound the scan to this circle but keep the ranking on the settler, for a bound that is a work
     *  area rather than a sweep origin. Pass this or {@link area}, never both. */
    readonly within?: { center: NodeId; radius: number };
    readonly goodFilter?: ReadonlySet<number>;
    /** Resource nodes already claimed this tick, so one node is dug by one settler at a time. */
    readonly exclude?: ReadonlySet<Entity>;
    /** A node reserved to another settler across ticks, rejected even though this settler's trade
     *  could work it. */
    readonly reserved?: (node: Entity) => boolean;
  } = {},
): { entity: Entity; cell: NodeId; dist: number } | null {
  const { world, ctx, terrain, here, targets } = plan;
  const settler = plan;
  const candidates = targets.resources;
  const { area, within, goodFilter, exclude, reserved } = opts;
  const gate = plan.limit ?? undefined; // the settler's signpost confinement
  const allowed = jobAtomics(ctx, settler.jobType);
  // Dormancy gate: when the job's atomics intersect no harvest atomic present on any standing resource,
  // every candidate would fail the `allowed.has` check below, so the whole scan is provably null. The
  // probe set comes from the actual resources, so a node carrying an out-of-content atomic still gates.
  const present = resourceHarvestAtomics(world);
  let anyHarvestable = false;
  for (const atomic of present) {
    if (allowed.has(atomic)) {
      anyHarvestable = true;
      break;
    }
  }
  if (!anyHarvestable) return null;
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
  let scanned = candidates;
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
  // Resolved once per scan, behind the dormancy early-return. Both block layers matter: a building can
  // bury a deposit's work cell, and a hemmed-in deposit falls back to its own resource-blocked anchor.
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const unreachable = unreachableGoals(world, ctx, plan.entity);
  // Probed last in the accept, so a candidate rejected by the cheap gates never costs a region flood.
  const regions = routeRegions(world, ctx, terrain);
  const subject = needSubjectOf(world, plan.entity);
  // The XP gate depends only on the good, so it is resolved once per good per scan.
  const meetsNeedByGood = new Map<number, boolean>();
  // Ranked from `origin`, while the interaction cell still resolves from `here`, the route start.
  const best = nearestByCell(terrain, scanned, origin, (e) => {
    if (exclude?.has(e)) return null; // a colleague already digs this node
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) return null;
    if (area?.goodType !== undefined && res.goodType !== area.goodType) return null;
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
    // XP gate: this settler must have cleared the harvested good's `needforgood` thresholds.
    let meetsNeed = meetsNeedByGood.get(res.goodType);
    if (meetsNeed === undefined) {
      meetsNeed = settlerMeetsNeed(world, ctx, subject, 'good', res.goodType);
      meetsNeedByGood.set(res.goodType, meetsNeed);
    }
    if (!meetsNeed) return null;
    const cell = interactionCell(world, ctx, terrain, e, here); // work cell the settler walks to (from here)
    // A resource across static terrain sits in a different connected component, and `findPath` answers
    // "no route" from the same `componentOf` verdict. Limitation: bridges are not walkable yet, so the
    // two banks of a river are genuinely separate components.
    if (terrain.componentOf(here) !== terrain.componentOf(cell)) return null;
    // An overlay-blocked work cell is a goal `findPath` rejects. The settler's own cell is never
    // blocked for itself, so a deposit it already stands on still qualifies.
    if (cell !== here && blocked.has(cell)) return null;
    if (cell !== here && isUnreachableGoal(unreachable, cell)) return null;
    if (bound !== undefined && manhattan(terrain, bound.center, cell) > bound.radius) return null;
    if (gate !== undefined && !gate.allowsNode(cell)) return null; // outside the settler's signpost area
    if (regions.unroutable(here, cell)) return null; // a clear cell sealed off from the settler
    return { cell, payload: null };
  });
  // No same-side gate: a standing Resource is never Owner-stamped, so the test would always pass.
  return best === null ? null : { entity: best.entity, cell: best.cell, dist: best.distance };
}

/**
 * The nearest {@link GroundDrop} pile whose good `pick` selects, with its Manhattan distance. Every
 * `targets.groundDrops` entry already carries GroundDrop+Stockpile+Position, so the scan re-checks no
 * markers. The good `pick` returns then faces the work-cell reachability and signpost gates.
 */
function nearestDropFor(
  plan: PlannerContext,
  piles: readonly Entity[],
  pick: (e: Entity) => number | null,
  within?: { center: NodeId; radius: number },
): { pile: Entity; goodType: number; dist: number } | null {
  const { world, ctx, terrain, here } = plan;
  if (piles.length === 0) return null;
  const gate = plan.limit ?? undefined; // signpost confinement
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const gates: WorkCellGates = { terrain, blocked, memo: unreachableGoals(world, ctx, plan.entity) };
  const best = nearestByCell(terrain, piles, here, (e) => {
    const good = pick(e);
    if (good === null) return null;
    const cell = interactionCell(world, ctx, terrain, e, here);
    // Cheapest first: an out-of-area pile never pays the reachability probe below.
    if (within !== undefined && manhattan(terrain, within.center, cell) > within.radius) return null;
    if (unreachableWorkCell(gates, here, cell)) return null; // the walk there would fail
    if (gate !== undefined && !gate.allowsNode(cell)) return null;
    return { cell, payload: good };
  });
  return best === null ? null : { pile: best.entity, goodType: best.payload, dist: best.distance };
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
): { pile: Entity; goodType: number; dist: number } | null {
  const { world, ctx, targets } = plan;
  const { goodFilter } = opts;
  const allowed = jobAtomics(ctx, plan.jobType);
  // Only piles of a good this trade harvests (and the caller forages for) are visited at all.
  const piles: (readonly Entity[])[] = [];
  for (const [good, harvestAtomic] of targets.harvestAtomicByGood) {
    if (!allowed.has(harvestAtomic) || (goodFilter !== undefined && !goodFilter.has(good))) continue;
    const ofGood = targets.groundDropsByGood.get(good);
    if (ofGood !== undefined) piles.push(ofGood);
  }
  return nearestDropFor(
    plan,
    // A pile holding two such goods sits in both lists, hence the set.
    piles.length === 1 ? (piles[0] ?? []) : canonicalById(new Set(piles.flat())),
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
): { pile: Entity; goodType: number; dist: number } | null {
  const { world, entity: gatherer, targets } = plan;
  return nearestDropFor(plan, targets.groundDropsByHarvester.get(gatherer) ?? [], (e) => {
    const mark = world.tryGet(e, HarvestedBy);
    if (mark === undefined || mark.by !== gatherer) return null; // not this gatherer's own drop
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) return null; // emptied, about to be reaped
    return good;
  });
}
