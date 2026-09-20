import { Health, Position, Projectile } from '../../../../../../components/index.js';
import type { AtomicEffect } from '../../../../../../core/atomic-effect.js';
import { eventAt } from '../../../../../../core/events.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { frightenWildlifeNear } from '../../../../../conflict/fright.js';
import type { SystemContext } from '../../../../../context.js';
import { mannedShelter } from '../../../../../defence/index.js';
import { entityNode } from '../../../../../spatial/nodes.js';

/**
 * Launch a {@link Projectile} at the shooter's attack-event frame, carrying the pre-resolved damage; the
 * `projectileSystem` then flies it and lands the same `resolveCombatHit` on contact.
 *
 * A garrison shot leaves the shelter, not the shooter's cell: a civilian manning one still stands on the
 * door node it entered by ({@link mannedShelter}). Every launch freezes the target's current position;
 * `missed` marks the same ballistic flight to land in the dirt without applying its payload.
 */
export function launchProjectile(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
  missed: boolean,
): void {
  if (effect.projectile === undefined) return; // not a ranged swing; the caller already gates this
  const cover = mannedShelter(world, attacker);
  const from = world.tryGet(cover ?? attacker, Position);
  if (from === undefined) return;
  // A target drained to 0 earlier this tick is dead but not yet reaped: no shot, and no launch cue, at a
  // corpse. Mirrors the projectileSystem's expiry test on arrival.
  const targetHealth = world.tryGet(effect.target, Health);
  if (targetHealth === undefined || targetHealth.hitpoints <= 0) return;
  const targetPos = world.tryGet(effect.target, Position);
  if (targetPos === undefined) return;
  const shot = world.create();
  world.add(shot, Position, { x: from.x, y: from.y });
  world.add(shot, Projectile, {
    source: attacker,
    target: effect.target,
    damage: effect.damage,
    weaponMainType: effect.weaponMainType ?? null,
    hitSoundType: effect.hitSoundType ?? null,
    missSounds: { ...effect.projectile.missSounds }, // the shot owns its copy, as the swing owns its own
    munitionType: effect.projectile.munitionType,
    speed: effect.projectile.speed,
    // The render's ballistic-arc origin, frozen at release and never read in flight.
    originX: from.x,
    originY: from.y,
    // Both the sim and render follow this release-time chord; a runner cannot bend an arrow in flight.
    aimX: targetPos.x,
    aimY: targetPos.y,
    cover,
    missAim: missed ? { x: targetPos.x, y: targetPos.y } : null,
    launchTick: ctx.tick,
  });
  ctx.events.emit({
    kind: 'projectileLaunched',
    projectile: shot,
    shooter: attacker,
    target: effect.target,
    munitionType: effect.projectile.munitionType,
    at: eventAt(from.x, from.y),
  });
  // The herd around the mark bolts at the release, whether the arrow will hit or miss.
  if (ctx.terrain !== undefined) {
    frightenWildlifeNear(world, ctx, ctx.terrain, entityNode(world, ctx.terrain, effect.target));
  }
}
