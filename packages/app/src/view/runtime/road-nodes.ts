import { type RoadNetworkView, roadNetworkOf } from '@open-northland/render/data';
import {
  countedBy,
  indexesOf,
  NODE_SET_STRIDE,
  nodeOfPosition,
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

/** The road network's node ids as a set, built once per network value, which a road change replaces. */
const roadNodesByNetwork = new WeakMap<RoadNetworkView, ReadonlySet<number>>();

function roadNodes(network: RoadNetworkView): ReadonlySet<number> {
  let nodes = roadNodesByNetwork.get(network);
  if (nodes === undefined) {
    nodes = new Set(network.nodes.map(([id]) => id));
    roadNodesByNetwork.set(network, nodes);
  }
  return nodes;
}

/**
 * Whether a road or a road site lies on a node, which a road line passes without ordering another.
 * `nodeWidth` is the map's width in half-cell nodes, the stride of the road network's node ids.
 */
export function roadBuiltAt(snapshot: WorldSnapshot, nodeWidth: number, col: number, row: number): boolean {
  if (col < 0 || col >= nodeWidth) return false;
  return (
    roadNodes(roadNetworkOf(snapshot)).has(row * nodeWidth + col) ||
    indexesOf(snapshot)
      .get(ROAD_SITE_NODES)
      .has(row * NODE_SET_STRIDE + col)
  );
}
