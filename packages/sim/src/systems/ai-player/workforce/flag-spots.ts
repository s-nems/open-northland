import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { workFlagPlacementTest } from '../../footprint/index.js';
import { type GathererReach, nearestLiveResource, type WorkableTest } from '../live-resources.js';
import { anchorNodeOf, nearestRingNode } from '../node-geometry.js';

/** A collector's flag stands 2-3 tiles from its resource (authored) - 4..6 half-cell nodes. */
export const FLAG_MIN_DISTANCE_NODES = 4;
export const FLAG_MAX_DISTANCE_NODES = 6;
/** When the whole 2-3-tile band is blocked, any legal node this close still serves. */
const FLAG_FALLBACK_MAX_DISTANCE_NODES = 12;
/** How many nearest resources one re-plant tries (authored): a resource whose best flag spot is taken or
 *  from which the holder could not work it gives way to the next nearest. */
const REPLANT_ATTEMPTS = 3;

/** The spots a decision has already handed out, which its later posts must keep off: two flags on one
 *  node would share a single delivery yard and its per-tile pile cap. A flag that already stands is in
 *  the placement blocker set, but one whose `setWorkFlag` is still in flight is invisible to it. */
export type TakenFlagNodes = Set<string>;

function flagNodeKey(hx: number, hy: number): string {
  return `${hx},${hy}`;
}

/** Manhattan distance between two half-cell nodes, the metric of the flag band. */
export function nodeDistance(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

export function claimFlagNode(taken: TakenFlagNodes, spot: HalfCellNode): void {
  taken.add(flagNodeKey(spot.hx, spot.hy));
}

/** The decision's legal work-flag test over `taken`, resolved once per spot search (one blocker scan). */
export function legalFlagNodeTest(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  taken: TakenFlagNodes,
): (x: number, y: number) => boolean {
  const placeable = workFlagPlacementTest(world, ctx.content, terrain);
  return (x, y) => terrain.inBounds(x, y) && placeable(terrain.nodeAt(x, y)) && !taken.has(flagNodeKey(x, y));
}

/**
 * The legal work-flag node in the 2-3-tile band around a resource nearest `origin`, the base or workshop
 * its gatherer walks out from, on the band's innermost ring holding one; any nearby legal node when the
 * band is fully blocked, nearest `origin` again; null when none. The origin side keeps the flag between
 * the settlement and the deposit rather than behind it, where a man would round the whole deposit to dig
 * its far edge.
 */
export function flagSpotNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  resource: HalfCellNode,
  origin: HalfCellNode,
  taken: TakenFlagNodes,
): HalfCellNode | null {
  const legal = legalFlagNodeTest(world, ctx, terrain, taken);
  return (
    nearestRingNode(
      resource.hx,
      resource.hy,
      FLAG_MIN_DISTANCE_NODES,
      FLAG_MAX_DISTANCE_NODES,
      origin,
      legal,
    ) ?? nearestRingNode(resource.hx, resource.hy, 0, FLAG_FALLBACK_MAX_DISTANCE_NODES, origin, legal)
  );
}

/** The flag spot beside the good's workable live resource nearest `anchor`, or null when the map holds
 *  none (or no legal flag node stands near it). */
export function collectorSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  anchor: HalfCellNode,
  goodType: number,
  taken: TakenFlagNodes,
  workable: WorkableTest,
): HalfCellNode | null {
  const resource: Entity | null = nearestLiveResource(world, goodType, anchor, workable);
  if (resource === null) return null;
  const node = anchorNodeOf(world, resource);
  return node === null ? null : flagSpotNear(world, ctx, terrain, node, anchor, taken);
}

/** A re-plant: the resource the flag moves after and the spot beside it, `dry` when the map holds no
 *  candidate at all, or null when none of the nearest {@link REPLANT_ATTEMPTS} was one the holder could
 *  work. On null the holder keeps his post and the next decision retries: re-hiring him at the anchor spot
 *  would only churn (hire, dead patch, retire, hire). */
export type Replant = { readonly target: HalfCellNode; readonly spot: HalfCellNode } | 'dry' | null;

/**
 * Where `holder` re-plants a flag of `radius`: beside the resource `nearest` picks, on its `origin` side
 * (the anchor the search runs from), checked with the gatherer's own filters from the new spot, trying the
 * next nearest after a miss. `nearest` must honour the `open` test it is given, which drops the resources
 * already tried. Up to {@link REPLANT_ATTEMPTS} spot searches per call; the callers pay them only for a
 * holder not mid-action or on the periodic upkeep.
 */
export function replantSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  holder: Entity,
  radius: number,
  nearest: (open: WorkableTest) => Entity | null,
  origin: HalfCellNode,
  reach: GathererReach,
  taken: TakenFlagNodes,
): Replant {
  const tried = new Set<Entity>();
  const open = (e: Entity): boolean => !tried.has(e);
  for (let attempt = 0; attempt < REPLANT_ATTEMPTS; attempt++) {
    const resource = nearest(open);
    if (resource === null) return attempt === 0 ? 'dry' : null;
    const target = anchorNodeOf(world, resource);
    const spot = target === null ? null : flagSpotNear(world, ctx, terrain, target, origin, taken);
    if (target !== null && spot !== null && reach.canWork(holder, spot, radius, resource)) {
      return { target, spot };
    }
    tried.add(resource);
  }
  return null;
}
