import { type Fixed, fx } from '../../../../core/fixed.js';
import { ROW_STEP } from '../../../../nav/world-metric.js';

/** A Position y on the lattice's world axis, where separation measures on-screen distance; `worldX`
 *  gives the x. Scalar so the per-mover resolve allocates no point. */
export function worldYOf(y: Fixed): Fixed {
  return fx.mul(y, ROW_STEP);
}

/** A world-axis y back to Position grid y; `positionXOfWorld` takes the x back at that y. */
export function gridYOf(worldY: Fixed): Fixed {
  return fx.div(worldY, ROW_STEP);
}
