import { defineComponent, type Entity, type World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import type { NodeId } from '../nav/terrain/index.js';

export interface RoadNetworkState {
  /** Bumped by every change to any {@link RoadShard}, so a mirror re-syncs only on a change. */
  revision: number;
}

const network = defineWorldSingleton<RoadNetworkState>('RoadNetwork', 'movement', () => ({ revision: 0 }));
export const RoadNetwork = network.component;
export const roadNetworkState = (world: World) => network.read(world);
export function writeRoadNetwork(world: World, apply: (state: RoadNetworkState) => void): void {
  network.write(world, apply);
}

/** The edge of a road shard's square block in half-cell nodes: 32 cells, the render's terrain block. */
export const ROAD_SHARD_NODES = 64;

/** The key of the shard holding half-cell node (hx, hy): its block's row times this plus its column. */
export const ROAD_SHARD_KEY_STRIDE = 1 << 16;

export function roadShardKey(hx: number, hy: number): number {
  return Math.floor(hy / ROAD_SHARD_NODES) * ROAD_SHARD_KEY_STRIDE + Math.floor(hx / ROAD_SHARD_NODES);
}

/**
 * The roads of one {@link ROAD_SHARD_NODES} block, carried by an entity of its own, so a lay writes one
 * small component and a change reaches the snapshot, the digest and the render per block rather than
 * for the whole network. At most one shard per block.
 */
export const RoadShard = defineComponent<{
  /** {@link roadShardKey} of the block. */
  block: number;
  /** The half-cell nodes a road runs over in this block, in laying order. */
  nodes: NodeId[];
  /** Bumped by every change to {@link nodes}. */
  revision: number;
}>('RoadShard', 'movement');

/** A road ordered on one half-cell node and not yet laid. It blocks nothing: settlers walk over it and a
 *  builder stands beside it. Laying it destroys the site, since the road itself lives in
 *  {@link RoadShard}. */
export const RoadSite = defineComponent<{
  tribe: number;
  /** The bill resolved from content at placement, like a wall segment's. */
  construction: { goodType: number; amount: number }[];
  /** Exclusive builder claim, taken when a builder picks the site. */
  reservation: null | { builder: Entity };
}>('RoadSite', 'economy');
