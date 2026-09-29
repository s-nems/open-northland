import {
  ROAD_SHARD_NODES,
  RoadShard,
  roadNetworkState,
  roadShardKey,
  writeRoadNetwork,
} from '../../components/roads.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeArea } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** The road network's change counter: 0 until the first road, bumped by every change. */
export function roadRevision(world: World): number {
  return roadNetworkState(world).revision;
}

/** Every road node, shard by shard in ascending carrier id, each shard in laying order. Per-step
 *  readers ask the terrain's mirrored lane instead. */
export function* roadNodes(world: World): Generator<NodeId> {
  for (const e of world.canonicalQuery(RoadShard)) yield* world.get(e, RoadShard).nodes;
}

export function roadNodeCount(world: World): number {
  let count = 0;
  for (const e of world.query(RoadShard)) count += world.get(e, RoadShard).nodes.length;
  return count;
}

interface ShardCarriers {
  readonly generation: number;
  readonly byBlock: ReadonlyMap<number, Entity>;
}

const shardCarriers = new WeakMap<World, ShardCarriers>();

/** The carrier of each block's shard, re-derived when a shard comes or goes: a few per map. */
function carriersOf(world: World): ReadonlyMap<number, Entity> {
  const generation = world.componentGeneration(RoadShard);
  const held = shardCarriers.get(world);
  if (held !== undefined && held.generation === generation) return held.byBlock;
  const byBlock = new Map<number, Entity>();
  for (const e of world.canonicalQuery(RoadShard)) {
    const block = world.get(e, RoadShard).block;
    if (!byBlock.has(block)) byBlock.set(block, e);
  }
  shardCarriers.set(world, { generation, byBlock });
  return byBlock;
}

/** A token over the roads on the nodes of `area`: it changes whenever a shard it overlaps does. */
export function roadAreaKey(world: World, area: NodeArea): number {
  const carriers = carriersOf(world);
  const block = (node: number): number => Math.floor(node / ROAD_SHARD_NODES);
  let sum = 0;
  for (let by = block(area.minHy); by <= block(area.maxHy); by++) {
    for (let bx = block(area.minHx); bx <= block(area.maxHx); bx++) {
      const carrier = carriers.get(roadShardKey(bx * ROAD_SHARD_NODES, by * ROAD_SHARD_NODES));
      if (carrier !== undefined) sum += world.get(carrier, RoadShard).revision;
    }
  }
  return sum;
}

/**
 * Lay a road over `nodes`, skipping those that already carry one, and mirror the change into the
 * terrain's lanes at once, so a route searched later in the same tick already prefers it. Laying never
 * blocks a node, so a route searched before stays walkable; it just may no longer be the cheapest.
 * Writes only the shards of the blocks the new nodes lie in. System-internal: a player lays roads
 * through a command.
 */
export function layRoad(world: World, terrain: TerrainGraph, nodes: Iterable<NodeId>): void {
  // The lane is the O(1) road lookup; brought up to the world first, so it answers for it.
  syncRoadLane(world, terrain);
  const fresh = new Set<NodeId>();
  for (const node of nodes) {
    // Validates the id before it reaches hashed state.
    if (!terrain.isRoad(node)) fresh.add(node);
  }
  if (fresh.size === 0) return;
  const byBlock = new Map<number, NodeId[]>();
  for (const node of fresh) {
    const block = roadShardKey(terrain.xOf(node), terrain.yOf(node));
    const held = byBlock.get(block);
    if (held === undefined) byBlock.set(block, [node]);
    else held.push(node);
  }
  const from = roadRevision(world);
  writeRoadNetwork(world, (state) => {
    state.revision += 1;
  });
  const carriers = carriersOf(world);
  for (const [block, added] of byBlock) {
    const carrier = carriers.get(block);
    if (carrier === undefined) {
      world.add(world.create(), RoadShard, { block, nodes: added, revision: 1 });
      continue;
    }
    const shard = world.mut(carrier, RoadShard);
    shard.nodes.push(...added);
    shard.revision += 1;
  }
  if (!terrain.extendRoads(from, roadRevision(world), fresh)) syncRoadLane(world, terrain);
}

/** Mirror the world's road network into its simulation's own `terrain` when the revision moved: before
 *  every tick and after a restore, so a restored world's roads reach the per-step readers. */
export function syncRoadLane(world: World, terrain: TerrainGraph): void {
  const revision = roadRevision(world);
  if (terrain.mirroredRoadRevision !== revision) terrain.syncRoads(revision, roadNodes(world));
}
