import type { ContentSet } from '@open-northland/data';
import type { World } from '../../ecs/world.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { goodsSearchLimitAt } from './reach.js';

/**
 * The settlement `player` holds around `node`: what the goods search from there reaches, the reach a porter
 * standing there fetches through. With signpost navigation off that search sets no bound, so the node's land
 * bounds it instead. Either way another island is never in it, and with signposts on neither is a second
 * settlement of the same player beyond the walks and posts that join them. Our own rule for whatever hands
 * one settlement's people, animals or stock to another place.
 */
export function settlementReachAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
  node: NodeId,
): SpatialGate {
  return (
    goodsSearchLimitAt(world, content, terrain, player, terrain.xOf(node), terrain.yOf(node)) ??
    landGate(terrain, terrain.componentOf(node))
  );
}

/** Every node of `component`, none for a node off walkable ground. */
function landGate(terrain: TerrainGraph, component: number): SpatialGate {
  if (component === NO_COMPONENT) return NOWHERE;
  const box = terrain.componentBounds(component);
  return {
    bounds: { minX: box.minX, maxX: box.maxX, minY: box.minY, maxY: box.maxY },
    allowsNode: (node) => terrain.componentOf(node) === component,
  };
}

const NOWHERE: SpatialGate = {
  bounds: { minX: 0, maxX: -1, minY: 0, maxY: -1 },
  allowsNode: () => false,
};
