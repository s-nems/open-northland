import { type BuildingType, type FootprintCell, footprintCellDx } from '@open-northland/data';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { BuildOrderEntry } from './entries.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from './entries.js';

/** A seat with fewer buildable grass nodes than this within {@link BUILD_SEARCH_MAX_RADIUS_NODES} of its
 *  base keeps its other buildings off the grass (authored): about the reserved zones of the full list's
 *  farm, wells, hives and herb hut. On the decoded maps the snow-corner seats of zimna_wojna hold
 *  140-480 such nodes, the green starts 1000-1900. */
export const GRASS_SCARCE_BELOW_NODES = 600;

/** Whether the building only stands on grass: the engine's bio-pattern rule (the well, the hive) or the
 *  entry's own `plantable` restriction (the farm, the herb hut). */
export function grassBound(type: BuildingType, entry?: Extract<BuildOrderEntry, { kind: 'place' }>): boolean {
  return type.buildOnBioPattern || entry?.ground === 'plantable';
}

// The terrain is immutable, so a base's verdict never changes; keyed by the base's anchor node.
const scarceByTerrain = new WeakMap<TerrainGraph, Map<NodeId, boolean>>();

/** Whether the ground within the build reach of `base` holds fewer than {@link GRASS_SCARCE_BELOW_NODES}
 *  buildable grass nodes. */
export function grassScarce(terrain: TerrainGraph, base: HalfCellNode): boolean {
  if (!terrain.inBounds(base.hx, base.hy)) return false;
  let byBase = scarceByTerrain.get(terrain);
  if (byBase === undefined) {
    byBase = new Map();
    scarceByTerrain.set(terrain, byBase);
  }
  const key = terrain.nodeAt(base.hx, base.hy);
  const known = byBase.get(key);
  if (known !== undefined) return known;
  const radius = BUILD_SEARCH_MAX_RADIUS_NODES;
  let grass = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const span = radius - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const x = base.hx + dx;
      const y = base.hy + dy;
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (terrain.isBuildable(node) && terrain.isPlantable(node)) grass++;
    }
  }
  const scarce = grass < GRASS_SCARCE_BELOW_NODES;
  byBase.set(key, scarce);
  return scarce;
}

/** Whether the zone `cells` anchored at `(x, y)` covers a grass node. */
export function coversGrass(
  terrain: TerrainGraph,
  cells: readonly FootprintCell[],
  x: number,
  y: number,
): boolean {
  for (const c of cells) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (terrain.inBounds(cx, cy) && terrain.isPlantable(terrain.nodeAt(cx, cy))) return true;
  }
  return false;
}
