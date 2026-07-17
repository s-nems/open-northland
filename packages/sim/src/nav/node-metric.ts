import type { NodeId } from './terrain/index.js';

/**
 * The WORLD-METRIC node-lattice geometry shared by every circle-shaped area rule (signpost circles, and
 * the node-lattice twin of the vision ellipse in `vision/system.ts` `stampVision`): a half-cell node step
 * is 34 px E/W and 19 px N/S of the measured 68×38 projection pitch, and a radius of R nodes means
 * R·34 px, so circles read circular on screen. The per-row stagger's ±half-node wobble is deliberately
 * ignored, exactly as vision ignores it (a half-cell fringe on a work-area edge — named approximation).
 * Exact integer arithmetic, no floats — the circle rules feed game state, so a float here would be a
 * determinism hazard.
 */

/** One node's E/W pitch in native px (half the 68 px column step) — the radius unit. The same measured
 *  pitch `metric.ts` mints as {@link import('./metric.js').HALF_COLUMN}, in integer px instead of
 *  column units; re-calibrating the projection moves both. */
const NODE_STEP_PX = 34;
/** One node's N/S pitch in native px (half the 38 px row step) — {@link import('./metric.js').HALF_ROW}
 *  (19/68 column units) in integer px. */
const HALF_ROW_PX = 19;

/** An axis-aligned box on the node lattice (inclusive bounds) — the coarse extent of a node-circle union. */
export interface NodeBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * A spatial confinement over half-cell nodes: membership (`allowsNode`) plus a {@link NodeBox} every
 * allowed node provably lies in (`bounds`). The target searches take the PAIR as one value — membership
 * decides, the box only bounds ring expansion / region scans — so a bound can never be applied without
 * its matching gate (applying `bounds` alone would silently drop valid candidates).
 */
export interface SpatialGate {
  /** Whether `node` lies inside the allowed area. */
  allowsNode(node: NodeId): boolean;
  /** A box provably containing every allowed node — a scan bound, never a membership test. */
  readonly bounds: NodeBox;
}

/**
 * The bounding {@link NodeBox} of a set of world-metric node circles: a radius of R nodes spans ±R on the
 * x axis but ±⌈R·34/19⌉ rows on the y axis (the anisotropic pitch above), so the box provably contains
 * every node any circle admits.
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
