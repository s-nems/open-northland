import { type Fixed, fx, ULP, ZERO } from '../../core/fixed.js';
import { ROW_STEP, worldDistance, worldX } from '../../nav/metric.js';

/**
 * Advance `p` STRAIGHT toward `target` by at most `speed` along the line between them, snapping onto
 * `target` (and returning `true`) once within one step — the arrival signal the caller advances the
 * path on. The step length is measured in the WORLD METRIC of the staggered lattice
 * (`nav/metric.ts` {@link worldDistance}: a row step is half a column sideways + 19/34 down), so a
 * walk covers the same ON-SCREEN distance per tick in every direction — an E/W leg (a full 68 px
 * column) takes the configured walk-cycle duration at the default cruise pace, a row-crossing
 * lattice leg (a 51 px edge, ¾ the length) proportionally fewer. Measuring in raw grid units
 * instead made a north–south walk read ~25% slower than an east–west one and a re-path leg lurch
 * (the reported speed wobble; source basis "Movement on the staggered lattice"). Mirrors the
 * projectile advance's fixed-point isqrt homing.
 *
 * On an E/W leg both endpoints share a row, so the stagger shift cancels, the world distance IS
 * `|dx|`, and the fused `mulDiv` advance is bit-exact `speed`. Every other heading scales the grid
 * delta by the world distance with a single truncation; the ulp it can shave is absorbed by the
 * arrival snap (no drift accumulates across legs) and the maths is pure fixed-point, so identical
 * inputs yield identical state.
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
    // Within one step (incl. already on it): snap exactly onto the waypoint so no drift accumulates
    // across legs, and signal arrival.
    p.x = target.x;
    p.y = target.y;
    return true;
  }
  // Advance the grid delta scaled to one world-metric step — fused `mulDiv`, so the only rounding
  // is the final truncation (an E/W leg's step is bit-exact `speed`; a chained mul+div shaved
  // enough ulps per tick to cost every leg an extra near-stationary tick). `dist > speed > 0`
  // here, so each division is safe.
  const stepX = fx.mulDiv(dx, speed, dist);
  const stepY = fx.mulDiv(dy, speed, dist);
  if (stepX === ZERO && stepY === ZERO) {
    // Totality guard for a degenerate 1–2 ulp gait on a NON-AXIS leg: the world metric inflates
    // `dist` past both |dx| and |dy|, so both components truncate to zero and — with the arrival
    // snap gated on `dist <= speed` — the walker would stall forever. Advance the dominant grid
    // component by one ulp instead: progress every tick, so every path still terminates. The tie
    // goes to x (E/W) — a named pick, not iteration luck. Unreachable at any real gait (the cruise
    // floor and ceil-minted ramp quanta sit far above); only an absurd data-minted MoveSpeed lands here.
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
 * The unit-length WORLD-METRIC heading from `p` toward `target` (the same world axes as
 * {@link worldDistance}: Δ worldX across, Δ row · ROW_STEP down), or `null` for a zero-length leg.
 * Components are ≈±ONE — a few ulps over when the isqrt-truncated distance under-reads (the
 * shorter the leg, the larger the relative under-read), which the ramp clamp bounds — and are
 * consumed only as a unit vector for dot products. Pure fixed-point.
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

/**
 * Turn a path follower onto the leg at `pf.index`: project its momentum onto the new leg's world
 * heading — `speed × cos(turn angle)` via the fixed-point dot product. Straight through costs nothing
 * (bit-identical headings are skipped exactly, so a straight multi-cell run never decays); a 45°
 * lattice turn keeps ~71%; a right angle or reversal stops the gait dead (it re-accelerates from
 * rest). Two callers, one turn rule: waypoint arrival (where `p` is exactly the old waypoint — the
 * arrival snap), and the REROUTE splice in `routing.ts` (where `p` is wherever the walker stands
 * mid-leg) — a player redirect turns the body exactly like a path corner does, so a redirected
 * walker can never keep full pace through a flip (the reported full-speed floor slide). Either way
 * the stored heading is the OLD leg's and the fresh one is measured from `p` toward the new
 * waypoint. A zero-length next leg keeps the old heading (nothing to turn onto); the (0,0) sentinel
 * — no established motion — stores the new heading without projecting. Part of the movement-inertia
 * approximation documented with the movement constants.
 */
export function turnOntoNextLeg(
  pf: { waypoints: Array<{ x: Fixed; y: Fixed }>; index: number; speed: Fixed; hx: Fixed; hy: Fixed },
  p: { x: Fixed; y: Fixed },
): void {
  const next = pf.waypoints[pf.index];
  if (next === undefined) return;
  const h = legHeading(p, next);
  if (h === null) return;
  const hasHeading = pf.hx !== ZERO || pf.hy !== ZERO;
  if (hasHeading && (h.x !== pf.hx || h.y !== pf.hy)) {
    const dot = fx.add(fx.mul(pf.hx, h.x), fx.mul(pf.hy, h.y));
    pf.speed = dot > ZERO ? fx.mul(pf.speed, dot) : ZERO;
  }
  pf.hx = h.x;
  pf.hy = h.y;
}
