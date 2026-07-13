import { type Fixed, fx } from '../../../../core/fixed.js';
import { positionXOfWorld } from '../../../../nav/halfcell.js';
import { ROW_STEP, worldX } from '../../../../nav/metric.js';

/** A point in the lattice's world axes, where separation measures on-screen distance. */
export interface SeparationPoint {
  x: Fixed;
  y: Fixed;
}

export function separationWorldPoint(x: Fixed, y: Fixed): SeparationPoint {
  return { x: worldX(x, y), y: fx.mul(y, ROW_STEP) };
}

/** Convert a world-axis point back to Position grid coordinates. */
export function separationGridPoint(point: SeparationPoint): { x: Fixed; y: Fixed } {
  const y = fx.div(point.y, ROW_STEP);
  return { x: positionXOfWorld(point.x, y), y };
}
