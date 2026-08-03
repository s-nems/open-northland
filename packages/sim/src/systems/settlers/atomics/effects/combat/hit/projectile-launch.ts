import { Health, Position, Projectile } from '../../../../../../components/index.js';
import type { AtomicEffect } from '../../../../../../core/atomic-effect.js';
import { eventAt } from '../../../../../../core/events.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { frightenWildlifeNear } from '../../../../../conflict/fright.js';
import type { SystemContext } from '../../../../../context.js';
import { mannedShelter } from '../../../../../defence/index.js';
import { entityNode } from '../../../../../spatial/nodes.js';

/**
 * Launch a {@link Projectile} at the shooter's ATTACK-event frame - the ranged branch of a swing (a bow
 * loosing an arrow, a catapult a rock). Creates a bare entity at the shooter's current cell carrying the
 * projectile payload (the pre-resolved `damage`, the target it homes on, the weapon class for fight XP,
 * the ammo class + travel `speed`) and announces it (`projectileLaunched`) for render/audio. The
 * `projectileSystem` then flies it and lands the same `resolveCombatHit` on contact.
 *
 * A GARRISON shot leaves the building, not the shooter's cell: a civilian manning a shelter still stands
 * on the door node it entered by, but it shoots from up in the tower ({@link mannedShelter}).
 *
 * A `missed` launch (the shooter's aim roll, decided by the caller at this same frame) freezes its aim at
 * the target's CURRENT position instead: the arrow flies there ballistically and lands in the dirt - the
 * flight is real, the blow never is.
 *
 * No shot if the launch point has no {@link Position} (the shooter vanished mid-draw) or the target has
 * already been destroyed by the time the string is loosed (no live `Health` - the archer looses at nothing;
 * mirrors the melee path's tolerate-a-vanished-target). A target that dies *during* the arrow's flight is the
 * `projectileSystem`'s expire case, not this one. Pure over entity state; no RNG/wall-clock.
 */
export function launchProjectile(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
  missed: boolean,
): void {
  if (effect.projectile === undefined) return; // not a ranged swing (defensive - the caller gates this)
  const cover = mannedShelter(world, attacker);
  const from = world.tryGet(cover ?? attacker, Position);
  if (from === undefined) return; // shooter (or its shelter) vanished mid-draw - no shot
  // No shot at a target already gone OR drained to 0 by an earlier hit this tick (dead but not yet reaped):
  // don't spend a projectile/launch cue on a corpse. Mirrors the projectileSystem's expiry test on arrival.
  const targetHealth = world.tryGet(effect.target, Health);
  if (targetHealth === undefined || targetHealth.hitpoints <= 0) return;
  const targetPos = world.tryGet(effect.target, Position);
  if (targetPos === undefined) return; // unpositioned target - nowhere to aim, hit or miss
  const shot = world.create();
  world.add(shot, Position, { x: from.x, y: from.y });
  world.add(shot, Projectile, {
    source: attacker,
    target: effect.target,
    damage: effect.damage,
    weaponMainType: effect.weaponMainType ?? null,
    munitionType: effect.projectile.munitionType,
    speed: effect.projectile.speed,
    // The chord's start, frozen at release - the render's ballistic-arc parameter (never read in flight).
    originX: from.x,
    originY: from.y,
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
  // The scare is the RELEASE's, not the landing's: the herd around the mark bolts whether the arrow
  // will hit or miss (the aim roll already decided, but the wildlife can't know).
  if (ctx.terrain !== undefined) {
    frightenWildlifeNear(world, ctx, ctx.terrain, entityNode(world, ctx.terrain, effect.target));
  }
}
