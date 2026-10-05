import { type Fixed, fx } from '../../core/fixed.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import { worldDistance, worldX } from '../../nav/world-metric.js';

const TWO: Fixed = fx.fromInt(2);

/** The integer floor of a Fixed. `fx.toInt` truncates toward zero, which is one too high for a negative
 *  fraction, and a west-border seam transient can sit a quarter-column left of world x = 0. */
function floorInt(v: Fixed): number {
  const t = fx.toInt(v);
  return v < fx.fromInt(t) ? t - 1 : t;
}

/**
 * The route-start node for a walker at fixed-point position `(x,y)`: the nearest traversable node among
 * the four that bracket the position on the half-cell lattice, by world-metric distance with ascending
 * cell id as the tie-break. The nearest bracket node alone can be unwalkable, since a diagonal leg is
 * legal with one impassable flank, and `findPath` rejects an unwalkable start outright, which would
 * strand the walker mid-seam. Falls back to the truncated node when no bracket node is traversable.
 */
export function routeStartCell(
  terrain: TerrainGraph,
  x: Fixed,
  y: Fixed,
  traversal: Traversal = 'land',
): NodeId {
  // World coordinates in half-cell units: the lattice is rectangular in world space, so the nearest
  // node is one of the four floor/ceil corners of (2·worldX, 2·row).
  const wx = fx.mul(worldX(x, y), TWO);
  const wy = fx.mul(y, TWO);
  const lowX = floorInt(wx);
  const lowY = floorInt(wy);
  const cols = wx === fx.fromInt(lowX) ? [lowX] : [lowX, lowX + 1];
  const rows = wy === fx.fromInt(lowY) ? [lowY] : [lowY, lowY + 1];
  let best: NodeId | undefined;
  let bestD: Fixed | undefined;
  for (const col of cols) {
    for (const row of rows) {
      const cell = terrain.nodeAtClamped(col, row);
      if (!terrain.traversable(cell, traversal)) continue;
      const c = terrain.coordsOf(cell);
      const centre = positionOfNode(c.x, c.y);
      const d = worldDistance(x, y, centre.x, centre.y);
      if (bestD === undefined || d < bestD || (d === bestD && best !== undefined && cell < best)) {
        best = cell;
        bestD = d;
      }
    }
  }
  if (best !== undefined) return best;
  const n = nodeOfPosition(x, y);
  return terrain.nodeAtClamped(n.hx, n.hy);
}
