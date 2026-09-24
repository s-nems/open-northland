import { type PositionValue, readNumFieldOrNull } from '../../snapshot/index.js';

/** The point a shot was loosed from (`Projectile.originX/originY`, fixed-point), or `null` when
 *  unreadable - the arc then draws flat along the straight line. */
export function readProjectileOrigin(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Projectile as { originX?: unknown; originY?: unknown } | undefined;
  if (p === undefined || typeof p.originX !== 'number' || typeof p.originY !== 'number') return null;
  return { x: p.originX, y: p.originY };
}

/** The release-time target point (`Projectile.aimX/aimY`, fixed-point), or `null` when unreadable. */
export function readProjectileAim(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Projectile as { aimX?: unknown; aimY?: unknown } | undefined;
  if (p === undefined || typeof p.aimX !== 'number' || typeof p.aimY !== 'number') return null;
  return { x: p.aimX, y: p.aimY };
}

/** The building a garrison shot was loosed from (`Projectile.cover`), or `null` for a shot from open
 *  ground - the scene reads only which of the two arc shapes to draw. */
export function readProjectileCover(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'Projectile', 'cover');
}

/** The `munitionType` a shot's sprite binds by, or `null` when unreadable. */
export function readProjectileMunition(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'Projectile', 'munitionType');
}

/** Whether the shot is a siege shot, one that bursts on the ground where it lands (`Projectile.impact`). */
export function readProjectileSiege(components: Readonly<Record<string, unknown>>): boolean {
  const p = components.Projectile as { impact?: unknown } | undefined;
  return p?.impact !== undefined && p.impact !== null;
}
