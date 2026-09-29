import { type RoadShardView, roadShardOf } from '@open-northland/render/data';
import {
  countedBy,
  groupedBy,
  indexesOf,
  NODE_SET_STRIDE,
  nodeOfPosition,
  roadShardKey,
  type WorldSnapshot,
} from '@open-northland/sim';
import { positionOf } from '../../game/snapshot-base.js';

/** The road site count on each half-cell node, keyed `hy * NODE_SET_STRIDE + hx`, kept per change. */
const ROAD_SITE_NODES = countedBy(
  (entity) => {
    if (!Object.hasOwn(entity.components, 'RoadSite')) return undefined;
    const at = positionOf(entity);
    if (at === undefined) return undefined;
    const { hx, hy } = nodeOfPosition(at.x, at.y);
    return hy * NODE_SET_STRIDE + hx;
  },
  'road site nodes',
  { values: ['Position'], presence: ['RoadSite'] },
);

/** The road shard carriers by the sim's shard key: one per block holding roads. */
const ROAD_SHARDS = groupedBy((entity) => roadShardOf(entity)?.block, 'road shards', {
  values: ['RoadShard'],
});

/** Each shard's nodes as a set, built once per shard value, which a lay in that block replaces. */
const shardNodeSets = new WeakMap<RoadShardView, ReadonlySet<number>>();

function shardAt(snapshot: WorldSnapshot, col: number, row: number): RoadShardView | null {
  const carrier = indexesOf(snapshot).get(ROAD_SHARDS).get(roadShardKey(col, row))?.[0];
  return carrier === undefined ? null : roadShardOf(carrier);
}

function shardNodes(shard: RoadShardView): ReadonlySet<number> {
  let nodes = shardNodeSets.get(shard);
  if (nodes === undefined) {
    nodes = new Set(shard.nodes);
    shardNodeSets.set(shard, nodes);
  }
  return nodes;
}

/**
 * Whether a road or a road site lies on a node, which a road line passes without ordering another.
 * `nodeWidth` is the map's width in half-cell nodes, the stride of the road network's node ids.
 */
export function roadBuiltAt(snapshot: WorldSnapshot, nodeWidth: number, col: number, row: number): boolean {
  if (col < 0 || col >= nodeWidth) return false;
  const shard = shardAt(snapshot, col, row);
  return (
    (shard !== null && shardNodes(shard).has(row * nodeWidth + col)) ||
    indexesOf(snapshot)
      .get(ROAD_SITE_NODES)
      .has(row * NODE_SET_STRIDE + col)
  );
}
