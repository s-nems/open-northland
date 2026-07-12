import { type PositionValue, readNumFieldOrNull } from './component-access.js';

/**
 * The in-flight PROJECTILE component reads — the target a shot homes on and the point it was loosed from.
 * Together they fix the flight chord the scene builder draws the ballistic arc along. Pure + total.
 */

/**
 * The entity id an in-flight projectile homes on (the sim `Projectile.target`), or `null` for a
 * missing/malformed component. The scene aims the drawn arrow's {@link
 * import('../draw-item.js').DrawItem.rotation} at this target's live position — the sim re-aims its
 * homing step at the same target each tick, so the drawn heading tracks the true flight.
 */
export function readProjectileTarget(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'Projectile', 'target');
}

/**
 * The point a projectile was LOOSED from (the sim `Projectile.originX/originY`, fixed-point), or `null`
 * for a missing/malformed component. With the live target position it fixes the flight chord, and the
 * fraction flown along it is the scene builder's ballistic-arc parameter (lob height + tangent). A shot
 * with no readable origin simply draws flat along the straight line — never a throw.
 */
export function readProjectileOrigin(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Projectile as { originX?: unknown; originY?: unknown } | undefined;
  if (p === undefined || typeof p.originX !== 'number' || typeof p.originY !== 'number') return null;
  return { x: p.originX, y: p.originY };
}
