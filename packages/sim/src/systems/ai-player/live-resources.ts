import { Resource, ResourceFootprint, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/blocked.js';
import { routeRegions } from '../footprint/index.js';
import { resourceStanceCells } from '../footprint/interaction.js';
import { needSubjectOf, settlerMeetsNeed } from '../progression/index.js';
import { interactionCell, jobAtomics } from '../settlers/targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import { manhattan } from '../spatial/metric.js';
import { anyResourceNear, canonicalResources, resourcesNearNode } from '../spatial/resources.js';
import { anchorNodeOf } from './node-geometry.js';

/** The first expanding-box reach of the live-resource searches below (Chebyshev half-cell nodes). */
const RESOURCE_BOX_REACH_START = 16;
/**
 * The largest box walked before the live-resource searches fall back to the whole-map reference
 * scan. The cap only bounds the cost of a hopeless neighbourhood - the fallback reproduces the
 * exact linear winner past it (authored; the `RING_MAX_RADIUS` convention).
 */
const RESOURCE_BOX_REACH_MAX = 512;

/** Whether a gatherer can still stand to work a resource. */
export type WorkableTest = (e: Entity) => boolean;

/** The decision's {@link WorkableTest}: some stance cell of the resource lies clear of the live walk-block
 *  overlay, so a deposit a building has buried whole no longer counts. A gatherer tests only the stance cell
 *  nearest itself, so a partly buried one can still pass here. A node without a footprint is workable. */
export function workableResourceTest(world: World, ctx: SystemContext, terrain: TerrainGraph): WorkableTest {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  return (e) =>
    !world.has(e, ResourceFootprint) ||
    resourceStanceCells(world, terrain, e).some((cell) => !blocked.has(cell));
}

/**
 * A flag gatherer's own harvest filters, judged from his flag node as if he idled there: his trade's
 * atomic, the good's experience need, and the work cell nearest the flag lying inside the circle, clear of
 * the live overlay, on his side of any terrain seam, off his failed-route memo and routable. The settler
 * planner's harvest search needs a whole planner pass, so its filters are restated here. Signpost
 * confinement is left out: the seat plants its flags inside its own network.
 */
export interface GathererReach {
  /** Whether `holder` with a flag of `radius` on `flag` would take `resource`. */
  canWork(holder: Entity, flag: HalfCellNode, radius: number, resource: Entity): boolean;
  /** Whether any live resource of a good `wanted` accepts is one {@link canWork} takes. */
  patchHarvestable(
    holder: Entity,
    flag: HalfCellNode,
    radius: number,
    wanted: (goodType: number) => boolean,
  ): boolean;
}

const NO_ATOMICS: ReadonlySet<number> = new Set();

export function gathererReach(world: World, ctx: SystemContext, terrain: TerrainGraph): GathererReach {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const regions = routeRegions(world, ctx, terrain);
  const judge = (holder: Entity) => {
    const jobType = world.get(holder, Settler).jobType;
    const allowed = jobType === null ? NO_ATOMICS : jobAtomics(ctx, jobType);
    const subject = needSubjectOf(world, holder);
    const memo = unreachableGoals(world, ctx, holder);
    const needMet = new Map<number, boolean>();
    return {
      allowed,
      takes: (center: NodeId, radius: number, e: Entity, wanted: (goodType: number) => boolean): boolean => {
        const res = world.get(e, Resource);
        if (res.remaining <= 0 || !wanted(res.goodType) || !allowed.has(res.harvestAtomic)) return false;
        let met = needMet.get(res.goodType);
        if (met === undefined) {
          met = settlerMeetsNeed(world, ctx, subject, 'good', res.goodType);
          needMet.set(res.goodType, met);
        }
        if (!met) return false;
        const cell = interactionCell(world, ctx, terrain, e, center);
        if (manhattan(terrain, center, cell) > radius) return false;
        if (terrain.componentOf(cell) !== terrain.componentOf(center)) return false;
        if (cell !== center && (blocked.has(cell) || isUnreachableGoal(memo, cell))) return false;
        return !regions.unroutable(center, cell);
      },
    };
  };
  const centerOf = (flag: HalfCellNode): NodeId => terrain.nodeAtClamped(flag.hx, flag.hy);
  return {
    canWork: (holder, flag, radius, resource) =>
      judge(holder).takes(centerOf(flag), radius, resource, () => true),
    patchHarvestable: (holder, flag, radius, wanted) => {
      const { allowed, takes } = judge(holder);
      const center = centerOf(flag);
      const reach = radius + contentIndex(ctx.content).maxResourceWorkOffset;
      return anyResourceNear(
        world,
        flag.hx,
        flag.hy,
        reach,
        (e) => takes(center, radius, e, wanted),
        allowed,
      );
    },
  };
}

/** The best `(Manhattan distance, entity id)` live `goodType` resource `workable` accepts inside the
 *  Chebyshev `reach` box around `from`, or null. Candidates arrive ascending-id, so the strict `<` keeps
 *  the lowest id among the minimum distance - the same winner the reference scan picks. */
function bestLiveResourceInBox(
  world: World,
  goodType: number,
  from: HalfCellNode,
  reach: number,
  workable: WorkableTest | undefined,
): { entity: Entity; distance: number } | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of resourcesNearNode(world, from.hx, from.hy, reach)) {
    if (!isLiveResource(world, e, goodType)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const distance = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (distance < bestDistance && (workable === undefined || workable(e))) {
      best = e;
      bestDistance = distance;
    }
  }
  return best === null ? null : { entity: best, distance: bestDistance };
}

/** Whether `e` is a standing not-yet-empty resource of `goodType`. */
function isLiveResource(world: World, e: Entity, goodType: number): boolean {
  const r = world.get(e, Resource);
  return r.goodType === goodType && r.remaining > 0;
}

/**
 * The standing not-yet-empty resource of `goodType` nearest to `from` (Manhattan node distance,
 * ties to the lower entity id) that `workable` accepts, or null when the map holds none. Expanding boxes
 * over the resource region index, so a decision near a stocked neighbourhood never walks the whole
 * canonical list.
 */
export function nearestLiveResource(
  world: World,
  goodType: number,
  from: HalfCellNode,
  workable?: WorkableTest,
): Entity | null {
  for (let reach = RESOURCE_BOX_REACH_START; reach <= RESOURCE_BOX_REACH_MAX; reach *= 2) {
    const hit = bestLiveResourceInBox(world, goodType, from, reach, workable);
    if (hit === null) continue;
    // A winner at Manhattan ≤ reach is global: every node outside the Chebyshev `reach` box lies at
    // Manhattan ≥ reach+1, so nothing outside can beat or tie it.
    if (hit.distance <= reach) return hit.entity;
    // Only a box-corner hit (Manhattan up to 2·reach): every node at Manhattan ≤ hit.distance lies
    // inside the Chebyshev `hit.distance` box, so one exact re-query settles the winner.
    const exact = bestLiveResourceInBox(world, goodType, from, hit.distance, workable);
    return (exact ?? hit).entity;
  }
  // Nothing within the cap - the reference scan finds the same winner the uncapped search would.
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of canonicalResources(world)) {
    if (!isLiveResource(world, e, goodType)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (dist < bestDist && (workable === undefined || workable(e))) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Whether any not-yet-empty resource of `goodType` stands on the map - existence only, so the first
 * box holding a live node answers without ranking it. `near` seeds the expanding-box search (the
 * seat's base - collector goods are gathered around it); a null seed or a within-cap miss falls back
 * to the early-exit canonical scan, which alone decides a truly dry map.
 */
export function anyLiveResource(world: World, goodType: number, near: HalfCellNode | null): boolean {
  if (near !== null) {
    for (let reach = RESOURCE_BOX_REACH_START; reach <= RESOURCE_BOX_REACH_MAX; reach *= 2) {
      if (anyResourceNear(world, near.hx, near.hy, reach, (e) => isLiveResource(world, e, goodType))) {
        return true;
      }
    }
  }
  for (const e of canonicalResources(world)) {
    if (isLiveResource(world, e, goodType)) return true;
  }
  return false;
}
