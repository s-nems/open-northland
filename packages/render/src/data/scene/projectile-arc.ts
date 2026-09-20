import { clamp01 } from '../math.js';
import { tileToScreen } from '../projection/index.js';

/**
 * A render-only presentation over the sim's frozen release-time chord: the drawn arrow is lifted off that
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
  /** Stable projected point on the release-time chord, before ballistic lift. */
  readonly x: number;
  readonly y: number;
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
 * The projected anchor, lob height and tangent rotation for a projectile at map-space `current`, loosed
 * from `origin` toward the release-time `aim`. Progress is measured in map space, then applied to the
 * single projected origin-to-aim chord. Projecting every fractional row independently would add the
 * staggered raster's row-parity triangle wave to a straight diagonal shot.
 *
 * Without a readable `origin`, or on a degenerate chord, the arrow points straight at the aim and flies
 * flat from its ordinarily projected current point.
 */
export function projectileArc(
  current: { x: number; y: number },
  aim: { x: number; y: number },
  origin: { x: number; y: number } | null,
  launchHeight = 0,
): ProjectileArc {
  const currentScreen = tileToScreen(current.x, current.y);
  const aimScreen = tileToScreen(aim.x, aim.y);
  if (origin === null) {
    return {
      ...currentScreen,
      lift: 0,
      rotation: Math.atan2(aimScreen.y - currentScreen.y, aimScreen.x - currentScreen.x),
    };
  }

  const mapDx = aim.x - origin.x;
  const mapDy = aim.y - origin.y;
  const mapLengthSq = mapDx * mapDx + mapDy * mapDy;
  if (mapLengthSq === 0) return { ...currentScreen, lift: 0, rotation: 0 };

  // Orthogonal projection tolerates fixed-point rounding that puts an intermediate sim anchor a hair
  // off its ideal line without letting that error bend the displayed chord.
  const p = clamp01(((current.x - origin.x) * mapDx + (current.y - origin.y) * mapDy) / mapLengthSq);
  const originScreen = tileToScreen(origin.x, origin.y);
  const screenDx = aimScreen.x - originScreen.x;
  const screenDy = aimScreen.y - originScreen.y;
  const chord = Math.hypot(screenDx, screenDy);
  if (chord === 0) return { ...currentScreen, lift: 0, rotation: 0 };

  const arc = launchHeight > 0 ? coverFall(launchHeight, p) : groundLob(chord, p);
  return {
    x: originScreen.x + screenDx * p,
    y: originScreen.y + screenDy * p,
    lift: arc.height,
    rotation: Math.atan2(screenDy - arc.rise, screenDx),
  };
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
