import {
  Health,
  HOUSE_BEHAVIOUR,
  hasHouseBehaviour,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  ownerOf,
  Person,
  Position,
  recordHumanKill,
  recordPlayerAttack,
} from '../../../../../../components/index.js';
import type { AtomicEffect } from '../../../../../../core/atomic-effect.js';
import { eventAt } from '../../../../../../core/events.js';
import type { Fixed } from '../../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { combatTargetNode } from '../../../../../conflict/target-node.js';
import { isStructureTarget } from '../../../../../conflict/targeting.js';
import type { SystemContext } from '../../../../../context.js';
import { markStructureDamaged } from '../../../../../economy/repair.js';
import { woundBearer } from '../../../../../equipment/index.js';
import { grantFightExperience } from '../../../../../progression/index.js';
import { manhattan } from '../../../../../spatial/metric.js';
import { entityNode } from '../../../../../spatial/nodes.js';
import { atomicClipSounds, type SoundingAtomic } from '../../../sound-cue.js';
import { spawnCarcasses } from './carcass.js';
import { landedDamage } from './damage.js';
import { launchProjectile } from './projectile-launch.js';
import { collectHitReaction, type PendingHitReaction } from './reaction.js';
import { frightenStruckAnimal, provokeAnger, provokeHostility, turnOnAttacker } from './reactions.js';

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
  pendingReactions: PendingHitReaction[],
): void {
  if (effect.projectile !== undefined) {
    launchProjectile(world, ctx, attacker, effect);
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
  resolveCombatHit(world, ctx, attacker, effect.target, effect, pendingReactions, 'melee');
}

/** The blow a melee swing or a landing projectile delivers: the weapon's column for the victim (raised
 *  by the striker's experience on a melee blow), the striker's weapon class for the fight-experience
 *  bucket, and the impact sound the weapon lists for the victim's material. `from` is where the blow
 *  comes from, which a person's hit direction reads: a shot's release point, or the striker's own
 *  position when absent. */
export interface LandingBlow {
  readonly damage: number;
  readonly weaponMainType?: number | null;
  readonly hitSoundType?: number | null;
  readonly from?: { readonly x: Fixed; readonly y: Fixed };
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
 * the two cannot drift. {@link landedDamage} turns `blow.damage` into the hitpoints taken, on contact;
 * answers whether the blow did damage.
 * Original behavior: only a living human striker's amulets count, so a defence-mode building's shot
 * carries none. Reaching 0 hitpoints is dead; `cleanupSystem` reaps the corpse at the end of the tick. A dead
 * attacker is tolerated, since a dead archer's arrow still lands. A `collateral` blow, a siege burst on a side
 * not at war with the shooter, wounds as any other but provokes no stance change and records no attack.
 */
export function resolveCombatHit(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  target: Entity,
  blow: LandingBlow,
  pendingReactions: PendingHitReaction[],
  source: 'melee' | 'projectile' | 'collateral',
): boolean {
  // A target felled earlier this tick still holds its Health until cleanup reaps it: a blow there lands on a
  // corpse, which earns nothing and provokes no one, the same as a shot that is never loosed at one.
  const pool = world.tryGet(target, Health);
  if (pool === undefined || pool.hitpoints <= 0) return false;
  const from = blow.from ?? world.tryGet(attacker, Position);
  const damage = landedDamage(world, ctx, attacker, target, blow.damage, from);
  const weaponMainType = blow.weaponMainType ?? undefined;
  // A blow counts as damaging by its damage value, so an overkill still earns fight experience. Original
  // behavior: a blow that does no damage is silent, earns nothing and is no attack on the victim's side.
  const dealtDamage = damage > 0;
  // Ranged hits do not emit this, because `projectileSystem` announces its own `projectileHit`.
  if (source === 'melee' && dealtDamage) {
    const at = world.tryGet(target, Position);
    if (at !== undefined) {
      ctx.events.emit({
        kind: 'combatHit',
        attacker,
        target,
        at: eventAt(at.x, at.y),
        ...(weaponMainType !== undefined ? { weaponMainType } : {}),
        ...(blow.hitSoundType != null ? { soundType: blow.hitSoundType } : {}),
        ...(isStructureTarget(world, target) ? { structure: true } : {}),
      });
    }
  }
  // A script-shielded target still hears the blow and still turns on its attacker; only its pool is
  // spared here, as starvation spares it in the needs pass.
  const dealt = shieldedByScript(world, target) ? 0 : Math.max(0, damage);
  if (dealt > 0) {
    woundBearer(world, ctx, target, dealt);
    markStructureDamaged(world, ctx, target);
  }
  // Original behavior: a struck beast turns angry and a struck person reacts whatever the damage.
  provokeAnger(world, ctx, target);
  frightenStruckAnimal(world, ctx, attacker, target);
  if (dealtDamage && source !== 'collateral') provokeHostility(world, ctx, attacker, target);
  turnOnAttacker(world, ctx, attacker, target);
  // A damaging blow on a human marks its owner as attacked by the striker's owner, shield or no shield:
  // the original marks it on the computed damage, before the pool is touched.
  if (dealtDamage && source !== 'collateral' && world.has(target, Person)) {
    recordPlayerAttack(world, ownerOf(world, target), ownerOf(world, attacker));
  }
  if (dealtDamage) grantFightExperience(world, ctx, attacker, weaponMainType);
  if (world.get(target, Health).hitpoints <= 0) {
    spawnCarcasses(world, ctx, attacker, target);
    // Only humans are counted: a hunted animal and a razed house belong to no kill tally a goal reads.
    if (world.has(target, Person)) recordHumanKill(world, ownerOf(world, attacker));
  } else {
    collectHitReaction(world, ctx, target, pendingReactions); // applied after the caller's loop
  }
  return dealtDamage;
}

/** Whether a script has made this target unharmable - a human's invulnerable bit or a house's
 *  indestructible one. */
function shieldedByScript(world: World, target: Entity): boolean {
  return (
    hasMissionBehaviour(world, target, MISSION_BEHAVIOUR.INVULNERABLE) ||
    hasHouseBehaviour(world, target, HOUSE_BEHAVIOUR.INDESTRUCTIBLE)
  );
}
