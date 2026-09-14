import type { NodeId } from './terrain/index.js';

/**
 * The world-metric node-lattice geometry shared by every circle-shaped area rule. A half-cell node step
 * is 34 px E/W and 19 px N/S of the measured 68x38 projection pitch, and a radius of R nodes means R*34
 * px, so circles read circular on screen. Approximation: the per-row stagger's half-node wobble is
 * ignored, leaving a half-cell fringe on an area edge. Exact integer arithmetic, because the circle
 * rules feed game state.
 */

/** One node's E/W pitch in native px, the radius unit. The integer-px form of `HALF_COLUMN`. */
const NODE_STEP_PX = 34;
/** One node's N/S pitch in native px, the integer-px form of `HALF_ROW`. */
const HALF_ROW_PX = 19;

/** An axis-aligned box on the node lattice, bounds inclusive. */
export interface NodeBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * A spatial confinement over half-cell nodes. Searches take the pair as one value so a bound is never
 * applied without its matching membership test, which would silently drop valid candidates.
 */
export interface SpatialGate {
  /** Whether `node` lies inside the allowed area. */
  allowsNode(node: NodeId): boolean;
  /** A box provably containing every allowed node - a scan bound, never a membership test. */
  readonly bounds: NodeBox;
}

/**
 * The bounding {@link NodeBox} of a set of world-metric node circles. Under the anisotropic pitch a
 * radius of R nodes spans R on the x axis but ceil(R*34/19) rows on the y axis.
 */
export function nodeBoxOfCircles(
  circles: readonly { readonly x: number; readonly y: number; readonly r: number }[],
): NodeBox {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of circles) {
    const ry = Math.ceil((c.r * NODE_STEP_PX) / HALF_ROW_PX);
    if (c.x - c.r < minX) minX = c.x - c.r;
    if (c.x + c.r > maxX) maxX = c.x + c.r;
    if (c.y - ry < minY) minY = c.y - ry;
    if (c.y + ry > maxY) maxY = c.y + ry;
  }
  return { minX, maxX, minY, maxY };
}

/** The node box holding every node within hex `range` of `(x, y)`: the hexagon spans `range` columns
 *  and `range` rows each way. */
export function hexNodeBox(x: number, y: number, range: number): NodeBox {
  return { minX: x - range, maxX: x + range, minY: y - range, maxY: y + range };
}

/** The smallest {@link NodeBox} containing every box given. */
export function unionNodeBoxes(boxes: readonly NodeBox[]): NodeBox {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, maxX, minY, maxY };
}

/** Whether node `(bx, by)` lies within `radiusNodes` of node `(ax, ay)` on the world metric. */
export function withinNodeRadius(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radiusNodes: number,
): boolean {
  const dx = (bx - ax) * NODE_STEP_PX;
  const dy = (by - ay) * HALF_ROW_PX;
  const r = radiusNodes * NODE_STEP_PX;
  return dx * dx + dy * dy <= r * r;
}
