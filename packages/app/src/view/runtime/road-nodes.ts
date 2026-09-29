import { roadNetworkOf } from '@open-northland/render/data';
import { entitiesWith, nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { positionOf } from '../../game/snapshot-base.js';

/** The half-cell nodes a road or a road site lies on, as the sim's row-major node ids. */
const nodesBySnapshot = new WeakMap<WorldSnapshot, ReadonlySet<number>>();

/**
 * Whether a road or a road site lies on a node, which a road line passes without ordering another. Built
 * once per snapshot from the road network and the road site index, and only while a road tool asks.
 * `nodeWidth` is the map's width in half-cell nodes.
 */
export function roadBuiltAt(snapshot: WorldSnapshot, nodeWidth: number, col: number, row: number): boolean {
  let nodes = nodesBySnapshot.get(snapshot);
  if (nodes === undefined) {
    const built = new Set<number>();
    for (const [id] of roadNetworkOf(snapshot).nodes) built.add(id);
    for (const site of entitiesWith(snapshot, 'RoadSite')) {
      const at = positionOf(site);
      if (at === undefined) continue;
      const { hx, hy } = nodeOfPosition(at.x, at.y);
      built.add(hy * nodeWidth + hx);
    }
    nodes = built;
    nodesBySnapshot.set(snapshot, nodes);
  }
  return col >= 0 && col < nodeWidth && nodes.has(row * nodeWidth + col);
}
