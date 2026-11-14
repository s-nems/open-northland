import type { ContentSet } from '@open-northland/data';
import type { World } from '../../ecs/world.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import { intersectReach } from '../../nav/range-search.js';
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
  return goodsSearchGate(world, content, terrain, player, node);
}

/** Where a fetch from `here` may find its source: `gate`, the fetcher's own bound, met with the goods search
 *  there, else the land under `here`, so no source across water is ever picked. */
export function goodsSearchGate(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  owner: number | undefined,
  here: NodeId,
  gate?: SpatialGate,
): SpatialGate {
  const goods = goodsSearchLimitAt(world, content, terrain, owner, terrain.xOf(here), terrain.yOf(here));
  return intersectReach(gate, goods) ?? landReachAt(terrain, here);
}

/**
 * The land under `node`: every node a walk from there can reach, none for a node off walkable ground. What
 * bounds a search that signpost confinement leaves unlimited, so it never picks a target across water.
 */
export function landReachAt(terrain: TerrainGraph, node: NodeId): SpatialGate {
  const component = terrain.componentOf(node);
  if (component === NO_COMPONENT) return NOWHERE;
  let gates = landGates.get(terrain);
  if (gates === undefined) {
    gates = new Map();
    landGates.set(terrain, gates);
  }
  let gate = gates.get(component);
  if (gate === undefined) {
    const box = terrain.componentBounds(component);
    gate = {
      bounds: { minX: box.minX, maxX: box.maxX, minY: box.minY, maxY: box.maxY },
      allowsNode: (n) => terrain.componentOf(n) === component,
    };
    gates.set(component, gate);
  }
  return gate;
}

/** One gate per land of a terrain: its components never change, so a gate stands for the terrain's life. */
const landGates = new WeakMap<TerrainGraph, Map<number, SpatialGate>>();

const NOWHERE: SpatialGate = {
  bounds: { minX: 0, maxX: -1, minY: 0, maxY: -1 },
  allowsNode: () => false,
};
