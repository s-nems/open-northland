import { type PositionValue, readNumFieldOrNull } from '../../snapshot/index.js';

/**
 * The in-flight projectile component reads — the target a shot homes on and the point it was loosed from.
 * Together they fix the flight chord the scene builder draws the ballistic arc along.
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
 * The point a projectile was loosed from (the sim `Projectile.originX/originY`, fixed-point), or `null`
 * for a missing/malformed component. With the live target position it fixes the flight chord, and the
 * fraction flown along it is the scene builder's ballistic-arc parameter (lob height + tangent). A shot
 * with no readable origin simply draws flat along the straight line — never a throw.
 */
export function readProjectileOrigin(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Projectile as { originX?: unknown; originY?: unknown } | undefined;
  if (p === undefined || typeof p.originX !== 'number' || typeof p.originY !== 'number') return null;
  return { x: p.originX, y: p.originY };
}

/**
 * A MISSED shot's frozen aim point (the sim `Projectile.missAim`, fixed-point), or `null` for a true
 * homing shot. When set it replaces the live target position as the chord's end - aiming the drawn
 * arrow at the (fleeing) target would bend its nose and stall its lob off the real flight.
 */
export function readProjectileMissAim(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Projectile as { missAim?: unknown } | undefined;
  const aim = p?.missAim as { x?: unknown; y?: unknown } | null | undefined;
  if (aim === null || aim === undefined || typeof aim.x !== 'number' || typeof aim.y !== 'number') {
    return null;
  }
  return { x: aim.x, y: aim.y };
}
