import { type Fixed, fx, ULP, ZERO } from '../../core/fixed.js';
import { ROW_STEP, worldDistance, worldX } from '../../nav/world-metric.js';

/**
 * Advance `p` straight toward `target` by at most `speed`, snapping onto `target` and returning `true` once
 * within one step. Step length is measured in the staggered lattice's world metric, so a walk covers the
 * same on-screen distance per tick in every direction; measuring in raw grid units instead reads a
 * north-south walk about 25% slower than an east-west one.
 *
 * On an E/W leg both endpoints share a row, the stagger cancels, and the fused `mulDiv` advance is bit-exact
 * `speed`. Every other heading truncates once, and the ulp that shaves is absorbed by the arrival snap.
 */
export function stepTowardPoint(
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  speed: Fixed,
): boolean {
  const dx = fx.sub(target.x, p.x);
  const dy = fx.sub(target.y, p.y);
  const dist = worldDistance(p.x, p.y, target.x, target.y);
  if (dist <= speed) {
    // Snap exactly onto the waypoint so no drift accumulates across legs.
    p.x = target.x;
    p.y = target.y;
    return true;
  }
  // Fused `mulDiv` keeps the only rounding in the final truncation; a chained mul+div sheds enough ulps
  // per tick to cost every leg an extra near-stationary tick. `dist > speed > 0` here, so division is safe.
  const stepX = fx.mulDiv(dx, speed, dist);
  const stepY = fx.mulDiv(dy, speed, dist);
  if (stepX === ZERO && stepY === ZERO) {
    // Totality guard for a degenerate 1-2 ulp gait on a non-axis leg: the world metric inflates `dist`
    // past both |dx| and |dy|, both components truncate to zero, and the walker would stall forever.
    // Advance the dominant grid component by one ulp instead, ties to x, so every path terminates. Only
    // an absurd data-minted MoveSpeed reaches this.
    const ax = dx < ZERO ? fx.sub(ZERO, dx) : dx;
    const ay = dy < ZERO ? fx.sub(ZERO, dy) : dy;
    if (ax >= ay) {
      p.x = dx > ZERO ? fx.add(p.x, ULP) : fx.sub(p.x, ULP);
    } else {
      p.y = dy > ZERO ? fx.add(p.y, ULP) : fx.sub(p.y, ULP);
    }
    return false;
  }
  p.x = fx.add(p.x, stepX);
  p.y = fx.add(p.y, stepY);
  return false;
}

/**
 * The unit-length world-metric heading from `p` toward `target`, or `null` for a zero-length leg. A component
 * can run a few ulps past ONE where the isqrt-truncated distance under-reads.
 */
export function legHeading(
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
): { x: Fixed; y: Fixed } | null {
  const dist = worldDistance(p.x, p.y, target.x, target.y);
  if (dist <= ZERO) return null;
  const dwx = fx.sub(worldX(target.x, target.y), worldX(p.x, p.y));
  const dwy = fx.mul(fx.sub(target.y, p.y), ROW_STEP);
  return { x: fx.div(dwx, dist), y: fx.div(dwy, dist) };
}
