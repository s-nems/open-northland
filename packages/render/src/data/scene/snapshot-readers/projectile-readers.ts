import { type PositionValue, readNumFieldOrNull } from '../../snapshot/index.js';

/** The entity an in-flight shot homes on (`Projectile.target`), or `null` when unreadable. */
export function readProjectileTarget(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'Projectile', 'target');
}

/** The point a shot was loosed from (`Projectile.originX/originY`, fixed-point), or `null` when
 *  unreadable - the arc then draws flat along the straight line. */
export function readProjectileOrigin(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Projectile as { originX?: unknown; originY?: unknown } | undefined;
  if (p === undefined || typeof p.originX !== 'number' || typeof p.originY !== 'number') return null;
  return { x: p.originX, y: p.originY };
}

/** The building a garrison shot was loosed from (`Projectile.cover`), or `null` for a shot from open
 *  ground - the scene reads only which of the two arc shapes to draw. */
export function readProjectileCover(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'Projectile', 'cover');
}

/**
 * A missed shot's frozen aim point (`Projectile.missAim`, fixed-point), or `null` for a true homing
 * shot. When set it replaces the live target position as the flight chord's end, so a miss keeps
 * flying past the (moving) target instead of bending its nose back onto it.
 */
export function readProjectileMissAim(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Projectile as { missAim?: unknown } | undefined;
  const aim = p?.missAim as { x?: unknown; y?: unknown } | null | undefined;
  if (aim === null || aim === undefined || typeof aim.x !== 'number' || typeof aim.y !== 'number') {
    return null;
  }
  return { x: aim.x, y: aim.y };
}
