import type { ContentSet } from '@open-northland/data';
import { DeliveryFlag } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { EXCLUSION, eachBlockerCell, placementBlockerVersion } from './blockers.js';

// WORK-FLAG PLACEMENT — where a work flag (and, through canPlaceWorkFlag, a signpost) may stand: the same
// ./blockers.ts scan the building rule reads, minus the EXCLUSION channel and plus the markers.

/** The nodes a work flag may NOT occupy: every standing resource/building body cell plus the other
 *  markers' cells — every {@link eachBlockerCell} channel except {@link EXCLUSION}, since a
 *  resource/building margin zone remains valid open ground for a flag. Built fresh per call — one-shot
 *  command checks call it through {@link canPlaceWorkFlag}; a per-node band probe (the signpost overlay)
 *  builds it once and reuses the set. */
export function workFlagPlacementBlocks(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  ignoreFlag?: Entity,
): ReadonlySet<NodeId> {
  const blocked = new Set<NodeId>();
  eachBlockerCell(
    world,
    content,
    (x, y, channel) => {
      if (channel === EXCLUSION) return; // a margin zone is open ground for a flag
      if (terrain.inBounds(x, y)) blocked.add(terrain.nodeAt(x, y));
    },
    { ignoreFlag },
  );
  return blocked;
}

export function canPlaceWorkFlag(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  node: NodeId,
  ignoreFlag?: Entity,
): boolean {
  return (
    terrain.isWalkable(node) && !workFlagPlacementBlocks(world, ctx.content, terrain, ignoreFlag).has(node)
  );
}

/** The nearest legal work-flag node to `from`, by Manhattan distance then node id. Auto-created flags use
 * this when a gatherer spawns or changes trade, because its feet may currently be inside a resource or
 * building body. This is a one-shot command/spawn query, never per-tick planner work. */
export function nearestWorkFlagPlacement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
): NodeId | null {
  const origin = terrain.coordsOf(from);
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain);
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let node = 0; node < terrain.nodeCount; node++) {
    const candidate = node as NodeId;
    if (!terrain.isWalkable(candidate) || blocked.has(candidate)) continue;
    const c = terrain.coordsOf(candidate);
    const distance = Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y);
    if (distance < bestDistance || (distance === bestDistance && (best === null || candidate < best))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The version of the WORK-FLAG blocker inputs — {@link placementBlockerVersion} plus the `DeliveryFlag`
 * generation, since this rule also consumes the marker channel the building rule ignores. The signpost
 * placement overlay keys its memoized band probe on this.
 */
export function workFlagBlockerVersion(world: World): string {
  return `${placementBlockerVersion(world)}.${world.componentGeneration(DeliveryFlag)}`;
}
