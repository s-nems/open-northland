import { forEachRingNode, HEX_HEADING_COUNT } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** A weapon's reach band in map points ({@link hexNodeDistance}). Original behavior: a target is in reach
 *  when its map-point distance lies within `[minRange, maxRange]`. */
export interface WeaponBand {
  readonly minRange: number;
  readonly maxRange: number;
}

/** Whether a target `dist` map points off is inside `band`. */
export function withinBand(band: WeaponBand, dist: number): boolean {
  return dist >= band.minRange && dist <= band.maxRange;
}

/** Visit every node within `band` of `centre`, nearest ring first, until `visit` answers false; answers
 *  whether the walk finished. Costs the band's area, about three times `maxRange` squared. */
export function forEachNodeInBand(
  terrain: TerrainGraph,
  centre: NodeId,
  band: WeaponBand,
  visit: (cell: NodeId) => boolean,
): boolean {
  const at = { hx: terrain.xOf(centre), hy: terrain.yOf(centre) };
  const onNode = (hx: number, hy: number): boolean => visit(terrain.nodeAt(hx, hy));
  for (let ring = band.minRange; ring <= band.maxRange; ring++) {
    if (!forEachRingNode(at, ring, terrain.width, terrain.height, onNode)) return false;
  }
  return true;
}

/** How many nodes lie `ring` map points from a node, clipping aside: six per map point, one at the centre. */
export function ringNodeCount(ring: number): number {
  return ring === 0 ? 1 : HEX_HEADING_COUNT * ring;
}

/** How many nodes `band` holds around a node, clipping aside. */
export function bandNodeCount(band: WeaponBand): number {
  let count = 0;
  for (let ring = band.minRange; ring <= band.maxRange; ring++) count += ringNodeCount(ring);
  return count;
}
