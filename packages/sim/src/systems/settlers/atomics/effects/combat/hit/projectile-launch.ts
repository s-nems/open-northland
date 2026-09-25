import { Health, Position, Projectile } from '../../../../../../components/index.js';
import type { AtomicEffect } from '../../../../../../core/atomic-effect.js';
import { eventAt } from '../../../../../../core/events.js';
import type { Fixed } from '../../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { frightenWildlifeNear } from '../../../../../conflict/fright.js';
import type { SystemContext } from '../../../../../context.js';
import { entityNode } from '../../../../../spatial/nodes.js';

type AttackEffect = Extract<AtomicEffect, { kind: 'attack' }>;

/** One shot as its shooter looses it: who fires, the payload resolved at release, and where it comes down
 *  if it is a miss. */
export interface LooseShot {
  readonly source: Entity;
  readonly target: Entity;
  readonly damage: number;
  readonly weaponMainType: number | null;
  readonly hitSoundType: number | null;
  readonly projectile: NonNullable<AttackEffect['projectile']>;
  /** The defence-mode building that fires the shot itself, read only by the render. */
  readonly cover: Entity | null;
  /** Where a missed shot lands; null for a shot still eligible to hit `target`. */
  readonly missAt: { x: Fixed; y: Fixed } | null;
}

/**
 * Launch a {@link Projectile} at the shooter's attack-event frame, carrying the pre-resolved damage; the
 * `projectileSystem` then flies it and lands the same `resolveCombatHit` on contact. `missed` marks the same
 * ballistic flight to land in the dirt at the target's release position without applying its payload.
 */
export function launchProjectile(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: AttackEffect,
  missed: boolean,
): void {
  if (effect.projectile === undefined) return; // not a ranged swing; the caller already gates this
  const targetPos = world.tryGet(effect.target, Position);
  if (targetPos === undefined) return;
  looseProjectile(world, ctx, {
    source: attacker,
    target: effect.target,
    damage: effect.damage,
    weaponMainType: effect.weaponMainType ?? null,
    hitSoundType: effect.hitSoundType ?? null,
    projectile: effect.projectile,
    cover: null,
    missAt: missed ? { x: targetPos.x, y: targetPos.y } : null,
  });
}

/**
 * Put `shot` in flight from its source's position. A true shot freezes the target's current position as its
 * aim; a miss flies to `missAt` instead and deals nothing there.
 */
export function looseProjectile(world: World, ctx: SystemContext, shot: LooseShot): void {
  const from = world.tryGet(shot.source, Position);
  if (from === undefined) return;
  // A target drained to 0 earlier this tick is dead but not yet reaped: no shot, and no launch cue, at a
  // corpse. Mirrors the projectileSystem's expiry test on arrival.
  const targetHealth = world.tryGet(shot.target, Health);
  if (targetHealth === undefined || targetHealth.hitpoints <= 0) return;
  const targetPos = world.tryGet(shot.target, Position);
  if (targetPos === undefined) return;
  const aim = shot.missAt ?? targetPos;
  const p = world.create();
  world.add(p, Position, { x: from.x, y: from.y });
  world.add(p, Projectile, {
    source: shot.source,
    target: shot.target,
    damage: shot.damage,
    weaponMainType: shot.weaponMainType,
    hitSoundType: shot.hitSoundType,
    missSounds: { ...shot.projectile.missSounds }, // the shot owns its copy, as the swing owns its own
    munitionType: shot.projectile.munitionType,
    speed: shot.projectile.speed,
    // The render's ballistic-arc origin, frozen at release and never read in flight.
    originX: from.x,
    originY: from.y,
    // Both the sim and render follow this release-time chord; a runner cannot bend an arrow in flight.
    aimX: aim.x,
    aimY: aim.y,
    cover: shot.cover,
    missAim: shot.missAt === null ? null : { x: aim.x, y: aim.y },
    launchTick: ctx.tick,
  });
  ctx.events.emit({
    kind: 'projectileLaunched',
    projectile: p,
    shooter: shot.source,
    target: shot.target,
    munitionType: shot.projectile.munitionType,
    at: eventAt(from.x, from.y),
  });
  // The herd around the mark bolts at the release, whether the arrow will hit or miss.
  if (ctx.terrain !== undefined) {
    frightenWildlifeNear(world, ctx, ctx.terrain, entityNode(world, ctx.terrain, shot.target));
  }
}
