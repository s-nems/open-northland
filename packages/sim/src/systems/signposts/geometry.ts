/**
 * The signpost circles' WORLD-METRIC node distance test — the node-lattice twin of the vision ellipse
 * (`vision/system.ts` `stampVision`): a half-cell node step is 34 px E/W and 19 px N/S of the measured
 * 68×38 projection pitch, and a radius of R nodes means R·34 px, so circles read circular on screen. The
 * per-row stagger's ±half-node wobble is deliberately ignored, exactly as vision ignores it (a half-cell
 * fringe on a work-area edge — named approximation). Exact integer arithmetic, no floats.
 */

/** One node's E/W pitch in native px (half the 68 px column step) — the radius unit. */
const NODE_STEP_PX = 34;
/** One node's N/S pitch in native px (half the 38 px row step). */
const HALF_ROW_PX = 19;

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
