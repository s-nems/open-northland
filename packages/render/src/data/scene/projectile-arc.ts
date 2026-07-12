import { clamp01 } from '../math.js';

/**
 * The drawn projectile's BALLISTIC ARC — a pure, render-only presentation layer over the sim's straight
 * homing flight. The sim advances a shot on a straight origin→target line (its own named approximation);
 * this lobs the DRAWN arrow above that line and tilts it along the arc's tangent, so a longbow shot visibly
 * arcs. No Pixi, no sim read-back — screen-space trig, unit-tested like the rest of the scene layer.
 * Source basis: observed original behaviour (arrows visibly lob); the shape is tuned by eye.
 */

/**
 * Ballistic-arc shape: the lob's PEAK height is this fraction of the shot's total origin→target screen
 * distance, capped at {@link PROJECTILE_ARC_PEAK_MAX_PX} so a max-range longbow shot (23 tiles — up to
 * ~1560 px on an east–west chord at 68 px/cell) doesn't leave the screen. Height is `4·peak·p·(1−p)` over
 * the fraction flown `p`, zero at both the bow and the impact. Exported so the tests pin the formula, not a
 * copy of today's tuning.
 */
export const PROJECTILE_ARC_PEAK_FRACTION = 0.12;
/** Cap on the lob's peak height (screen px) — see {@link PROJECTILE_ARC_PEAK_FRACTION}. */
export const PROJECTILE_ARC_PEAK_MAX_PX = 56;

/** A drawn projectile's arc presentation: the upward lob height (px, rides the lift draw channel — never
 *  the depth key) and the arrow's rotation (radians) tangent to the arc. */
export interface ProjectileArc {
  readonly lift: number;
  readonly rotation: number;
}

/**
 * The lob height + tangent rotation for a projectile drawn at `current`, flying toward `target`, loosed
 * from `origin` — all in screen space. Without a readable `origin` (or a degenerate chord/flight) the arrow
 * simply points straight at the target and flies flat (`lift 0`), never a throw. With one: the fraction
 * flown `p` along the origin→target chord sets a parabolic height `4·peak·p·(1−p)` and shears the straight
 * heading by the arc's slope `dh/ds` (screen-up is −y) so the nose rides up while climbing, down while
 * falling. Homing can stretch the path past the launch chord (the target moves), so `p` is clamped to
 * `[0, 1]`. Pure.
 */
export function projectileArc(
  current: { x: number; y: number },
  target: { x: number; y: number },
  origin: { x: number; y: number } | null,
): ProjectileArc {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  let rotation = Math.atan2(dy, dx);
  let lift = 0;
  if (origin !== null) {
    const chord = Math.hypot(target.x - origin.x, target.y - origin.y);
    const remaining = Math.hypot(dx, dy);
    if (chord > 0 && remaining > 0) {
      const p = clamp01(1 - remaining / chord);
      const peak = Math.min(chord * PROJECTILE_ARC_PEAK_FRACTION, PROJECTILE_ARC_PEAK_MAX_PX);
      lift = 4 * peak * p * (1 - p);
      const slope = (4 * peak * (1 - 2 * p)) / chord;
      rotation = Math.atan2(dy / remaining - slope, dx / remaining);
    }
  }
  return { lift, rotation };
}
