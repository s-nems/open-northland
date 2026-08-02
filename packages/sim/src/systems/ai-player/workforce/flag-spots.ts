import { Resource } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { nodeBoxOfCircles, withinNodeRadius } from '../../../nav/node-circle.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { workFlagPlacementBlocks } from '../../footprint/index.js';
import { anyResourceNear } from '../../spatial/resources.js';
import { anchorNodeOf, firstRingNode, nearestLiveResource } from '../shared.js';

/** A collector's flag stands 2–3 tiles from its resource (user rule) - 4..6 half-cell nodes. */
export const FLAG_MIN_DISTANCE_NODES = 4;
export const FLAG_MAX_DISTANCE_NODES = 6;
/** When the whole 2–3-tile band is blocked, any legal node this close still serves. */
const FLAG_FALLBACK_MAX_DISTANCE_NODES = 12;

/** The spots a decision has already handed out, which its later posts must keep off: two flags on one
 *  node would share a single delivery yard and its per-tile pile cap. Only THIS decision's posts need
 *  tracking - a flag that already stands is in the placement blocker set, but one whose `setWorkFlag`
 *  is still in flight is invisible to it. Membership only, never iterated. */
export type TakenFlagNodes = Set<string>;

function flagNodeKey(hx: number, hy: number): string {
  return `${hx},${hy}`;
}

/** Record `spot` as spoken for, so a later post this decision picks a different node. */
export function claimFlagNode(taken: TakenFlagNodes, spot: HalfCellNode): void {
  taken.add(flagNodeKey(spot.hx, spot.hy));
}

/** Whether any live resource accepted by `alive` remains inside the flag's work circle (the
 *  world-metric circle the gatherer harvests in) - the "patch ran dry, move the flag" probe. An
 *  existence test, so it takes the region index's no-collection, no-sort path. */
export function patchAlive(
  world: World,
  flagNode: HalfCellNode,
  radius: number,
  alive: (r: { goodType: number; remaining: number }) => boolean,
): boolean {
  // The region-index box must contain the anisotropic circle (±radius nodes E/W, wider in rows).
  const box = nodeBoxOfCircles([{ x: flagNode.hx, y: flagNode.hy, r: radius }]);
  const reach = Math.max(box.maxX - flagNode.hx, box.maxY - flagNode.hy);
  return anyResourceNear(world, flagNode.hx, flagNode.hy, reach, (e) => {
    const r = world.get(e, Resource);
    if (r.remaining <= 0 || !alive(r)) return false;
    const node = anchorNodeOf(world, e);
    return node !== null && withinNodeRadius(flagNode.hx, flagNode.hy, node.hx, node.hy, radius);
  });
}

/** The closest legal work-flag node in the 2–3-tile band around a resource (falling back to any
 *  nearby legal node when the band is fully blocked, and never onto a node this decision already
 *  handed out), or null. One blocker scan per call. */
export function flagSpotNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  resource: HalfCellNode,
  taken: TakenFlagNodes,
): HalfCellNode | null {
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain);
  const legal = (x: number, y: number): boolean =>
    terrain.inBounds(x, y) &&
    terrain.isWalkable(terrain.nodeAt(x, y)) &&
    !blocked.has(terrain.nodeAt(x, y)) &&
    !taken.has(flagNodeKey(x, y));
  const inBand = (x: number, y: number): boolean =>
    Math.abs(x - resource.hx) + Math.abs(y - resource.hy) >= FLAG_MIN_DISTANCE_NODES && legal(x, y);
  return (
    firstRingNode(resource.hx, resource.hy, FLAG_MAX_DISTANCE_NODES, inBand) ??
    firstRingNode(resource.hx, resource.hy, FLAG_FALLBACK_MAX_DISTANCE_NODES, legal)
  );
}

/** The flag spot beside the good's live resource nearest the HQ, or null when the map holds none
 *  (or no legal flag node stands near it). */
export function collectorSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  hqNode: HalfCellNode,
  goodType: number,
  taken: TakenFlagNodes,
): HalfCellNode | null {
  const resource: Entity | null = nearestLiveResource(world, goodType, hqNode);
  if (resource === null) return null;
  const node = anchorNodeOf(world, resource);
  return node === null ? null : flagSpotNear(world, ctx, terrain, node, taken);
}
