import { roadNetworkState, writeRoadNetwork } from '../../components/roads.js';
import type { World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** Whether a road runs over `node`. Per-step readers use the terrain's mirrored lane instead. */
export function isRoad(world: World, node: NodeId): boolean {
  return roadNetworkState(world).nodes.has(node);
}

/** The road network's change counter: 0 until the first road, bumped by every change. */
export function roadRevision(world: World): number {
  return roadNetworkState(world).revision;
}

/**
 * Lay a road over `nodes`, skipping those that already carry one, and mirror the change into the
 * terrain's lanes at once, so a route searched later in the same tick already prefers it. Laying never
 * blocks a node, so a route searched before stays walkable; it just may no longer be the cheapest.
 * System-internal: a player lays roads through a command.
 */
export function layRoad(world: World, terrain: TerrainGraph, nodes: Iterable<NodeId>): void {
  const fresh = new Set<NodeId>();
  const known = roadNetworkState(world).nodes;
  for (const node of nodes) {
    // Validates the id before it reaches hashed state.
    terrain.isRoad(node);
    if (!known.has(node)) fresh.add(node);
  }
  if (fresh.size === 0) return;
  const from = roadRevision(world);
  writeRoadNetwork(world, (state) => {
    for (const node of fresh) state.nodes.set(node, true);
    state.revision += 1;
  });
  if (!terrain.extendRoads(from, roadRevision(world), fresh)) syncRoadLane(world, terrain);
}

/** Mirror the world's road network into its simulation's own `terrain` when the revision moved: before
 *  every tick and after a restore, so a restored world's roads reach the per-step readers. */
export function syncRoadLane(world: World, terrain: TerrainGraph): void {
  const state = roadNetworkState(world);
  terrain.syncRoads(state.revision, state.nodes.keys());
}
