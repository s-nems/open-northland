import type { BlockOverlay } from '../../nav/block-overlay.js';
import { hexagonRing } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** Approximation: a water animal authored on a bank may land within twelve map points. A dry map
 * admits no water herd. The bounded search avoids a map-wide scan for each misplaced spawn. */
const WATER_SPAWN_RADIUS = 12;

export function waterAnimalSpawnNode(
  terrain: TerrainGraph,
  x: number,
  y: number,
  blocked: BlockOverlay,
  claimed: ReadonlySet<NodeId>,
  component?: number,
): NodeId | null {
  for (let radius = 0; radius <= WATER_SPAWN_RADIUS; radius++) {
    for (const { point } of hexagonRing({ hx: x, hy: y }, radius)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const node = terrain.nodeAt(point.hx, point.hy);
      if (!terrain.isWater(node) || blocked.has(node) || claimed.has(node)) continue;
      if (component !== undefined && terrain.componentOf(node) !== component) continue;
      return node;
    }
  }
  return null;
}
