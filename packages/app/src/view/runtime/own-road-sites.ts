import {
  entityById,
  indexesOf,
  NODE_SET_STRIDE,
  nodeOfPosition,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ownerPlayerOf, positionOf } from '../../game/snapshot-base.js';
import { idsGroupedBy } from '../../game/snapshot-id-index.js';

/** The road sites on each half-cell node, keyed `hy * NODE_SET_STRIDE + hx`, kept per change. A site
 *  takes its `Position` with its `RoadSite` and never moves, so only the site component places it; a
 *  moving entity's position writes cost the index nothing. */
const ROAD_SITES_BY_NODE = idsGroupedBy(
  (entity) => {
    if (!Object.hasOwn(entity.components, 'RoadSite')) return undefined;
    const at = positionOf(entity);
    if (at === undefined) return undefined;
    const { hx, hy } = nodeOfPosition(at.x, at.y);
    return hy * NODE_SET_STRIDE + hx;
  },
  'road sites by node',
  { presence: ['RoadSite'] },
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
  if (sites === undefined) return null;
  for (const id of sites) {
    const site = entityById(snapshot, id);
    if (site !== undefined && ownerPlayerOf(site) === owner) return id;
  }
  return null;
}
