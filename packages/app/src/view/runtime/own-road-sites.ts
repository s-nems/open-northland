import {
  groupedBy,
  indexesOf,
  NODE_SET_STRIDE,
  nodeOfPosition,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ownerPlayerOf, positionOf } from '../../game/snapshot-base.js';

/** The road sites on each half-cell node, keyed `hy * NODE_SET_STRIDE + hx`, kept per change. */
const ROAD_SITES_BY_NODE = groupedBy(
  (entity) => {
    if (!Object.hasOwn(entity.components, 'RoadSite')) return undefined;
    const at = positionOf(entity);
    if (at === undefined) return undefined;
    const { hx, hy } = nodeOfPosition(at.x, at.y);
    return hy * NODE_SET_STRIDE + hx;
  },
  'road sites by node',
  { values: ['Position'], presence: ['RoadSite'] },
);

/** `owner`'s road site on a node, or null: the site the road tool's cancel line withdraws there. */
export function ownRoadSiteAt(
  snapshot: WorldSnapshot,
  owner: number,
  col: number,
  row: number,
): number | null {
  if (col < 0 || col >= NODE_SET_STRIDE) return null;
  const sites = indexesOf(snapshot)
    .get(ROAD_SITES_BY_NODE)
    .get(row * NODE_SET_STRIDE + col);
  return sites?.find((site) => ownerPlayerOf(site) === owner)?.id ?? null;
}
