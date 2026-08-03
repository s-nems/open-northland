import { clamp01 } from '../math.js';

/**
 * The drawn projectile's ballistic arc - a pure, render-only presentation layer over the sim's straight
 * homing flight. The sim advances a shot on a straight origin→target line (its own named approximation);
 * this lifts the drawn arrow off that line and tilts it along the arc's tangent, so a shot visibly arcs.
 * No Pixi, no sim read-back - screen-space trig, unit-tested like the rest of the scene layer.
 * Source basis: observed original behaviour (arrows visibly lob); the lob and the fall are tuned by eye.
 */

/**
 * Ballistic-arc shape: the lob's peak height is this fraction of the shot's total origin→target screen
 * distance, capped at {@link PROJECTILE_ARC_PEAK_MAX_PX} so a max-range longbow shot (23 Manhattan
 * half-cell nodes ⇒ ~11.5 cells, up to ~780 px on an east–west chord at 68 px/cell) doesn't leave the
 * screen. Height is `4·peak·p·(1−p)` over the fraction flown `p`, zero at both the bow and the impact.
 * Exported so the tests pin the formula, not a copy of today's tuning.
 */
export const PROJECTILE_ARC_PEAK_FRACTION = 0.12;
/** Cap on the lob's peak height (screen px) - see {@link PROJECTILE_ARC_PEAK_FRACTION}. */
export const PROJECTILE_ARC_PEAK_MAX_PX = 56;

/**
 * The height (screen px) a garrison shot is loosed from - the lookout gallery. APPROXIMATED: no readable
 * record carries a firing-post height, and the decoded bob's pixel extent is not available in this pure
 * layer, so it is ONE constant, not a per-building metric - measured against the drawn silhouettes it must
 * sit inside (`tower_00` reaches 242 px above its feet, the headquarters 286), pending visual sign-off.
 */
export const COVER_LAUNCH_HEIGHT_PX = 140;

/** A drawn projectile's arc presentation: its height above the ground (px, rides the lift draw channel -
 *  never the depth key) and the arrow's rotation (radians) tangent to the arc. */
export interface ProjectileArc {
  readonly lift: number;
  readonly rotation: number;
}

/** One arc shape sampled at the fraction flown: its `height` above the ground (px) and `rise`, the
 *  derivative d(height)/dp that tilts the arrow's nose. */
interface ArcSample {
  readonly height: number;
  readonly rise: number;
}

/**
 * The lob height + tangent rotation for a projectile drawn at `current`, flying toward `target`, loosed
 * from `origin` `launchHeight` px above the ground - all in screen space. Without a readable `origin` (or
 * a degenerate chord/flight) the arrow simply points straight at the target and flies flat (`lift 0`),
 * never a throw. With one: the fraction flown `p` along the origin→target chord samples the shape
 * ({@link groundLob} or {@link coverFall}) and shears the straight heading by its slope `dh/ds` (screen-up
 * is −y) so the nose rides up while climbing, down while falling. Homing can stretch the path past the
 * launch chord (the target moves), so `p` is clamped to `[0, 1]` - a shot chasing a fleeing mark reads back
 * up its shape, since only the sim could freeze the chord it was loosed on.
 */
export function projectileArc(
  current: { x: number; y: number },
  target: { x: number; y: number },
  origin: { x: number; y: number } | null,
  launchHeight = 0,
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
      const arc = launchHeight > 0 ? coverFall(launchHeight, p) : groundLob(chord, p);
      lift = arc.height;
      rotation = Math.atan2(dy / remaining - arc.rise / chord, dx / remaining);
    }
  }
  return { lift, rotation };
}

/** A shot loosed at ground level: the symmetric lob `4·peak·p·(1−p)`, zero at the bow and at the impact. */
function groundLob(chord: number, p: number): ArcSample {
  const peak = Math.min(chord * PROJECTILE_ARC_PEAK_FRACTION, PROJECTILE_ARC_PEAK_MAX_PX);
  return { height: 4 * peak * p * (1 - p), rise: 4 * peak * (1 - 2 * p) };
}

/** A shot loosed from a height: `h·(1−p²)`, a free fall from `launchHeight` to the ground at the mark. It
 *  leaves level (rise 0 at the bow) and steepens as it drops, so a garrison's arrows rain down on the
 *  attackers instead of being lobbed up at them. */
function coverFall(launchHeight: number, p: number): ArcSample {
  return { height: launchHeight * (1 - p * p), rise: -2 * launchHeight * p };
}
