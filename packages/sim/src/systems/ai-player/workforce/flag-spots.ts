import { Resource } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { nodeBoxOfCircles, withinNodeRadius } from '../../../nav/node-metric.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/flags.js';
import { workFlagPlacementBlocks } from '../../footprint/index.js';
import { resourcesNearNode } from '../../resource-index.js';
import { anchorNodeOf, firstRingNode, nearestLiveResource, ownedSettlers } from '../shared.js';

/** A collector's flag stands 2–3 tiles from its resource (user rule) — 4..6 half-cell nodes. */
export const FLAG_MIN_DISTANCE_NODES = 4;
export const FLAG_MAX_DISTANCE_NODES = 6;
/** When the whole 2–3-tile band is blocked, any legal node this close still serves. */
const FLAG_FALLBACK_MAX_DISTANCE_NODES = 12;

/** The flag nodes a decision may not post a NEW gatherer onto: the seat's standing flags plus the
 *  spots already handed out this decision (whose `setWorkFlag` has not applied yet). Two flags on one
 *  node would share a single delivery yard and its per-tile pile cap. Relocating an existing flag
 *  ignores this set — its own node is in it. */
export type TakenFlagNodes = Set<string>;

function flagNodeKey(hx: number, hy: number): string {
  return `${hx},${hy}`;
}

/** The seat's standing flag nodes, the seed of a decision's {@link TakenFlagNodes}. */
export function flagNodesInUse(world: World, player: number): TakenFlagNodes {
  const taken: TakenFlagNodes = new Set();
  for (const e of ownedSettlers(world, player)) {
    const flag = liveWorkFlag(world, e);
    const node = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (node !== null) taken.add(flagNodeKey(node.hx, node.hy));
  }
  return taken;
}

/** Record `spot` as spoken for, so a later post this decision picks a different node. */
export function claimFlagNode(taken: TakenFlagNodes, spot: HalfCellNode): void {
  taken.add(flagNodeKey(spot.hx, spot.hy));
}

/** Whether any live resource accepted by `alive` remains inside the flag's work circle (the
 *  world-metric circle the gatherer harvests in) — the "patch ran dry, move the flag" probe. */
export function patchAlive(
  world: World,
  flagNode: HalfCellNode,
  radius: number,
  alive: (r: { goodType: number; remaining: number }) => boolean,
): boolean {
  // The region-index box must contain the anisotropic circle (±radius nodes E/W, wider in rows).
  const box = nodeBoxOfCircles([{ x: flagNode.hx, y: flagNode.hy, r: radius }]);
  const reach = Math.max(box.maxX - flagNode.hx, box.maxY - flagNode.hy);
  for (const e of resourcesNearNode(world, flagNode.hx, flagNode.hy, reach)) {
    const r = world.get(e, Resource);
    if (r.remaining <= 0 || !alive(r)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    if (withinNodeRadius(flagNode.hx, flagNode.hy, node.hx, node.hy, radius)) return true;
  }
  return false;
}

/** The closest legal work-flag node in the 2–3-tile band around a resource (falling back to any
 *  nearby legal node when the band is fully blocked), or null. One blocker scan per call. */
export function flagSpotNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  resource: HalfCellNode,
  taken?: TakenFlagNodes,
): HalfCellNode | null {
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain);
  const legal = (x: number, y: number): boolean =>
    terrain.inBounds(x, y) &&
    terrain.isWalkable(terrain.nodeAt(x, y)) &&
    !blocked.has(terrain.nodeAt(x, y)) &&
    !(taken?.has(flagNodeKey(x, y)) ?? false);
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
  taken?: TakenFlagNodes,
): HalfCellNode | null {
  const resource: Entity | null = nearestLiveResource(world, goodType, hqNode);
  if (resource === null) return null;
  const node = anchorNodeOf(world, resource);
  return node === null ? null : flagSpotNear(world, ctx, terrain, node, taken);
}
