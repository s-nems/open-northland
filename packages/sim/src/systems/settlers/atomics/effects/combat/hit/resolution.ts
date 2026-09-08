import {
  Building,
  Health,
  HOUSE_BEHAVIOUR,
  hasHouseBehaviour,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  ownerOf,
  Person,
  Position,
  recordHumanKill,
} from '../../../../../../components/index.js';
import type { AtomicEffect } from '../../../../../../core/atomic-effect.js';
import { eventAt } from '../../../../../../core/events.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { combatTargetNode } from '../../../../../conflict/target-node.js';
import type { SystemContext } from '../../../../../context.js';
import { tryDeathSaveDraught } from '../../../../../equipment/index.js';
import { grantFightExperience } from '../../../../../progression/index.js';
import { manhattan } from '../../../../../spatial/metric.js';
import { entityNode } from '../../../../../spatial/nodes.js';
import { atomicClipSounds, type SoundingAtomic } from '../../../sound-cue.js';
import { hunterShotMisses } from './aim.js';
import { spawnCarcasses } from './carcass.js';
import { launchProjectile } from './projectile-launch.js';
import { provokeAnger, provokeHostility } from './reactions.js';
import { collectStagger, type PendingStagger } from './stagger.js';

/**
 * Resolve an `attack` swing at its ATTACK-event frame, the mid-animation hit. A ranged swing launches a
 * projectile that resolves on contact; a melee swing whiffs if the target stepped beyond `effect.maxRange`
 * since the swing started, else lands the blow.
 */
export function resolveAttackHit(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  atomic: SoundingAtomic,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
  pendingStaggers: PendingStagger[],
): void {
  // A miss is decided at release, not on contact: the arrow still flies, aimed where the target stood.
  if (effect.projectile !== undefined) {
    launchProjectile(world, ctx, attacker, effect, hunterShotMisses(world, ctx, attacker));
    return;
  }
  // Before the reach check, so a whiff is heard too; a clip that sounds its own swing is left to do so.
  const swingFrom = world.tryGet(attacker, Position);
  if (swingFrom !== undefined && !atomicClipSounds(world, ctx, attacker, atomic)) {
    ctx.events.emit({ kind: 'combatSwing', attacker, at: eventAt(swingFrom.x, swingFrom.y) });
  }
  // Without a node graph or a `maxRange` the blow always lands on a live target.
  if (
    ctx.terrain !== undefined &&
    effect.maxRange !== undefined &&
    meleeTargetOutOfReach(world, ctx, attacker, effect)
  ) {
    return;
  }
  resolveCombatHit(
    world,
    ctx,
    attacker,
    effect.target,
    effect.damage,
    effect.weaponMainType,
    pendingStaggers,
    'melee',
  );
}

/**
 * Whether a melee swing's target has stepped beyond the weapon's reach since the swing started. Uses the
 * same `manhattan` node metric the CombatSystem's engage check uses, so a target that stayed put never
 * spuriously whiffs. A target with no live `Position` counts as out of reach.
 */
function meleeTargetOutOfReach(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined || effect.maxRange === undefined) return false; // caller-gated; keep types honest
  // Guarding the attacker too keeps `entityNode`'s `world.get` from throwing on one that lost its Position.
  if (world.tryGet(attacker, Position) === undefined) return true;
  if (world.tryGet(effect.target, Position) === undefined) return true;
  // Measuring to the target's combat node, the nearest wall cell for a building, matches the whiff band to
  // the reach the swing engaged within.
  const attackerNode = entityNode(world, terrain, attacker);
  const dist = manhattan(
    terrain,
    attackerNode,
    combatTargetNode(world, ctx, terrain, attackerNode, effect.target),
  );
  return dist > effect.maxRange;
}

/**
 * Land one combat blow, shared by a melee swing at its ATTACK frame and a ranged projectile on contact so
 * the two cannot drift. `damage` is the pre-resolved `weapon.damagevalue[targetMaterial]` column value, so
 * no content lookup happens here. Reaching 0 hitpoints is dead; `cleanupSystem` reaps the corpse at the end
 * of the tick. A dead attacker is tolerated, since a dead archer's arrow still lands.
 */
export function resolveCombatHit(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  target: Entity,
  damage: number,
  weaponMainType: number | undefined,
  pendingStaggers: PendingStagger[],
  source: 'melee' | 'projectile',
): void {
  const health = world.tryMut(target, Health);
  if (health === undefined) return; // gone or a non-combatant: the blow struck nothing
  // Ranged hits do not emit this, because `projectileSystem` announces its own `projectileHit`. A connect
  // fully absorbed by armor still cues, since the blade touched.
  if (source === 'melee') {
    const at = world.tryGet(target, Position);
    if (at !== undefined) {
      ctx.events.emit({
        kind: 'combatHit',
        attacker,
        target,
        at: eventAt(at.x, at.y),
        ...(weaponMainType !== undefined ? { weaponMainType } : {}),
        ...(world.has(target, Building) ? { structure: true } : {}),
      });
    }
  }
  // A blow counts as damaging by its damage value, so an overkill still earns fight experience.
  const dealtDamage = damage > 0;
  // A script-shielded target still hears the blow and still turns on its attacker; only its pool is
  // spared. Nothing regenerates a human here, so the flag's whole effect is this zero.
  const dealt = shieldedByScript(world, target) ? 0 : Math.max(0, damage);
  // The carcass spawns only on the alive-to-dead transition, so a second blow landing this tick on an
  // already-felled target never mints a second carcass.
  const wasAlive = health.hitpoints > 0;
  // The death-save resets the pool itself, but the blow still counted for XP and anger. A target already
  // at 0 is never revived.
  const saved = wasAlive && health.hitpoints - dealt <= 0 && tryDeathSaveDraught(world, ctx, target);
  if (!saved) health.hitpoints = Math.max(0, health.hitpoints - dealt);
  provokeAnger(world, ctx, target);
  provokeHostility(world, ctx, attacker, target);
  if (dealtDamage) grantFightExperience(world, ctx, attacker, weaponMainType);
  if (health.hitpoints <= 0) {
    if (wasAlive) {
      spawnCarcasses(world, ctx, attacker, target);
      // Only humans are counted: a hunted animal and a razed house belong to no kill tally a goal reads.
      if (world.has(target, Person)) recordHumanKill(world, ownerOf(world, attacker));
    }
  } else {
    collectStagger(world, ctx, target, pendingStaggers); // applied after the caller's loop
  }
}

/** Whether a script has made this target unharmable - a human's invulnerable bit or a house's
 *  indestructible one. */
function shieldedByScript(world: World, target: Entity): boolean {
  return (
    hasMissionBehaviour(world, target, MISSION_BEHAVIOUR.INVULNERABLE) ||
    hasHouseBehaviour(world, target, HOUSE_BEHAVIOUR.INDESTRUCTIBLE)
  );
}
