import { clamp01 } from '../math.js';

/**
 * A render-only presentation over the sim's straight homing flight: the drawn arrow is lifted off that
 * line and tilted along the arc's tangent. Source basis: observed original behaviour (arrows visibly
 * lob); the lob and the fall are tuned by eye.
 */

/**
 * Peak lob height as a fraction of the shot's origin→target screen distance, capped at
 * {@link PROJECTILE_ARC_PEAK_MAX_PX} so a max-range longbow shot (~11.5 cells, up to ~780 px on an
 * east-west chord at 68 px/cell) doesn't leave the screen.
 */
export const PROJECTILE_ARC_PEAK_FRACTION = 0.12;
/** Cap on the lob's peak height, in screen px. */
export const PROJECTILE_ARC_PEAK_MAX_PX = 56;

/**
 * The height (screen px) a garrison shot is loosed from. Approximation: no readable record carries a
 * firing-post height, so one constant covers every building, measured to sit inside the drawn
 * silhouettes (`tower_00` reaches 242 px above its feet, the headquarters 286).
 */
export const COVER_LAUNCH_HEIGHT_PX = 140;

/** Height above the ground in screen px, riding the lift draw channel and never the depth key, plus the
 *  arrow's rotation in radians, tangent to the arc. */
export interface ProjectileArc {
  readonly lift: number;
  readonly rotation: number;
}

/** One arc shape sampled at the fraction flown: `height` above the ground in px, and `rise`, the
 *  derivative d(height)/dp that tilts the arrow's nose. */
interface ArcSample {
  readonly height: number;
  readonly rise: number;
}

/**
 * The lob height and tangent rotation for a projectile drawn at `current`, loosed from `origin`
 * `launchHeight` px above the ground - all in screen space. Without a readable `origin`, or on a
 * degenerate chord, the arrow points straight at the target and flies flat. Homing can stretch the path
 * past the launch chord, so the fraction flown is clamped to `[0, 1]` and a shot chasing a fleeing mark
 * reads back up its own shape.
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

/** A shot loosed from a height: `h·(1−p²)`, a free fall from `launchHeight` to the ground at the mark.
 *  It leaves level and steepens as it drops, so a garrison's arrows rain down on the attackers. */
function coverFall(launchHeight: number, p: number): ArcSample {
  return { height: launchHeight * (1 - p * p), rise: -2 * launchHeight * p };
}
