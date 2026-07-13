import { Health, Position, Projectile } from '../../../../components/index.js';
import type { AtomicEffect } from '../../../../core/atomic-effect.js';
import { eventAt } from '../../../../core/events.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';

/**
 * Launch a {@link Projectile} at the shooter's ATTACK-event frame — the ranged branch of a swing (a bow
 * loosing an arrow, a catapult a rock). Creates a bare entity at the shooter's current cell carrying the
 * projectile payload (the pre-resolved `damage`, the target it homes on, the weapon class for fight XP,
 * the ammo class + travel `speed`) and announces it (`projectileLaunched`) for render/audio. The
 * `projectileSystem` then flies it and lands the same `resolveCombatHit` on contact.
 *
 * No shot if the shooter has no {@link Position} (it vanished mid-draw) or the target has already been
 * destroyed by the time the string is loosed (no live `Health` — the archer looses at nothing; mirrors the
 * melee path's tolerate-a-vanished-target). A target that dies *during* the arrow's flight is the
 * `projectileSystem`'s expire case, not this one. Pure over entity state; no RNG/wall-clock.
 */
export function launchProjectile(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
): void {
  if (effect.projectile === undefined) return; // not a ranged swing (defensive — the caller gates this)
  const from = world.tryGet(attacker, Position);
  if (from === undefined) return; // shooter vanished mid-draw — no shot
  // No shot at a target already gone OR drained to 0 by an earlier hit this tick (dead but not yet reaped):
  // don't spend a projectile/launch cue on a corpse. Mirrors the projectileSystem's expiry test on arrival.
  const targetHealth = world.tryGet(effect.target, Health);
  if (targetHealth === undefined || targetHealth.hitpoints <= 0) return;
  const shot = world.create();
  world.add(shot, Position, { x: from.x, y: from.y });
  world.add(shot, Projectile, {
    source: attacker,
    target: effect.target,
    damage: effect.damage,
    weaponMainType: effect.weaponMainType ?? null,
    munitionType: effect.projectile.munitionType,
    speed: effect.projectile.speed,
    // The chord's start, frozen at release — the render's ballistic-arc parameter (never read in flight).
    originX: from.x,
    originY: from.y,
  });
  ctx.events.emit({
    kind: 'projectileLaunched',
    projectile: shot,
    shooter: attacker,
    target: effect.target,
    munitionType: effect.projectile.munitionType,
    at: eventAt(from.x, from.y),
  });
}
