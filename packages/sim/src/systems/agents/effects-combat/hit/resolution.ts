import { Health, Position } from '../../../../components/index.js';
import type { AtomicEffect } from '../../../../core/atomic-effect.js';
import { eventAt } from '../../../../core/events.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { grantFightExperience } from '../../../progression/index.js';
import { entityNode, manhattan } from '../../../spatial.js';
import { launchProjectile } from './projectile-launch.js';
import { harvestCadaver, provokeAnger } from './reactions.js';
import { collectStagger, type PendingStagger } from './stagger.js';

/**
 * Resolve an `attack` swing's blow at the ATTACK-event frame — the mid-animation hit (see the executor
 * loop). Drains `effect.damage` hitpoints from the `target`'s {@link Health}, clamped at 0 (a hit never
 * *heals* — armor can fully absorb a blow but the pool never goes negative). `effect.damage` is the
 * pre-resolved column value the planner looked up (`weapon.damagevalue[targetMaterial]`), so the
 * executor needs no content/weapon lookup for it. A `target` with no `Health` is a no-op — it was
 * already destroyed between the swing starting and landing, or is a non-combatant (the swing struck
 * air); never throw, mirroring how `harvest`/`pickup` tolerate a vanished resource/store. Reaching 0
 * hitpoints is "dead"; the `cleanupSystem` reaps the corpse (removing the entity, emitting
 * `settlerDied`) at the end of the tick.
 *
 * A landed blow also drives four follow-ups:
 *  - **Provokes** an otherwise-passive `getAngry` animal ({@link provokeAnger}): a struck boar/deer
 *    gets an `Anger` timer so it fights back (the `animaltypes.ini` provoked-anger half; an
 *    already-`aggressive` animal needs none — source basis "Civ-vs-animal aggression").
 *  - **Fight XP** ({@link grantFightExperience}) on a **damaging** swing — accrues into the swinging
 *    weapon's fight bucket (keyed by `effect.weaponMainType`), the same expType space the soldier-class
 *    `needfor*` gates read. A 0-damage or missed swing trains nothing.
 *  - **Cadaver meat** ({@link harvestCadaver}) when the blow is **lethal** AND a hunter's strike on
 *    catchable prey — the `harvest_cadaver` payoff.
 *  - **Stagger** ({@link collectStagger}) when the target **survives** — a struck civilian visibly
 *    flinches (its data-driven `82` ATTACKED atomic), if interruptible. A felled target isn't staggered
 *    (it's being reaped); a soldier/animal with no `82` binding never flinches.
 */
export function resolveAttackHit(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
  pendingStaggers: PendingStagger[],
): void {
  // A RANGED swing (a bow/catapult) LAUNCHES a projectile at this frame instead of landing the blow in
  // place — the arrow/rock then flies (`projectileSystem`) and deals the same damage on contact. A melee
  // swing (no `projectile`) resolves the hit here and now.
  if (effect.projectile !== undefined) {
    launchProjectile(world, ctx, attacker, effect);
    return;
  }
  // A MELEE swing swooshes AT the strike frame (this frame) — the audible twin of a bow's release
  // `projectileLaunched`, synced to the visible blade connect rather than the windup start. Fired BEFORE
  // the reach check so EVERY swing is heard, hit or whiff (the blade cut air either way); the connecting
  // `combatHit` below adds the impact clang + blood only on a real connect. Silent if the attacker lost
  // its Position mid-swing (nothing to locate the sound at).
  const swingFrom = world.tryGet(attacker, Position);
  if (swingFrom !== undefined) {
    ctx.events.emit({ kind: 'combatSwing', attacker, at: eventAt(swingFrom.x, swingFrom.y) });
  }
  // A long melee swing the target BACKED OUT of whiffs: if the target has stepped beyond the weapon's reach
  // since the swing started, the blow lands nothing (no damage, no blood, no flinch) — the "enemy stepped
  // away, no adjacent target, the attack misses" case. Measured with the SAME node-manhattan metric the
  // CombatSystem started the swing within, so a target that stayed put (or closed in) never spuriously
  // whiffs. Skipped when the map has no node graph (a mapless fixture) or the effect carries no `maxRange`
  // — then the blow always lands on a live target, the pre-reach-check behaviour.
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
    'melee', // a melee blow — announce the connect (`combatHit`) for the blood/impact cue
  );
}

/**
 * Whether a melee swing's target has stepped BEYOND the weapon's reach since the swing started — the
 * whiff test. Compares the current attacker→target node distance (the SAME `manhattan` metric on the
 * terrain graph the CombatSystem's engage check uses) against the effect's carried `maxRange`. A target
 * with no live `Position` (vanished mid-swing) counts as out of reach — the swing hits nothing. Requires
 * `ctx.terrain` and `effect.maxRange` (the caller gates both). Pure over entity state; no RNG/wall-clock.
 */
function meleeTargetOutOfReach(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined || effect.maxRange === undefined) return false; // caller-gated; keep types honest
  // Either combatant lacking a live Position → the swing lands nothing (out of reach). Guarding the attacker
  // too keeps this symmetric with the target check and the swing-emit guard, and avoids `entityNode`'s
  // `world.get` throwing on an attacker that lost its Position mid-swing (unreachable in normal play).
  if (world.tryGet(attacker, Position) === undefined) return true; // attacker gone — nothing to strike from
  if (world.tryGet(effect.target, Position) === undefined) return true; // target gone — nothing to strike
  const dist = manhattan(
    terrain,
    entityNode(world, terrain, attacker),
    entityNode(world, terrain, effect.target),
  );
  return dist > effect.maxRange;
}

/**
 * Land one combat blow — the shared hit resolution both a melee swing (at its ATTACK frame) and a
 * ranged projectile (on contact) run, so the two can't drift (step 1's damage model, one place). Drains
 * `damage` hitpoints from `target`'s {@link Health}, clamped at 0 (a hit never *heals* — armor can fully
 * absorb a blow but the pool never goes negative). `damage` is the pre-resolved column value the planner
 * looked up (`weapon.damagevalue[targetMaterial]`), so this needs no content/weapon lookup. A `target`
 * with no `Health` is a no-op — already destroyed, or a non-combatant (the blow struck air); never throw.
 * Reaching 0 hitpoints is "dead"; the `cleanupSystem` reaps the corpse at the end of the tick.
 *
 * The four follow-ups a landed blow drives (all keyed on `attacker`, which a projectile's `tryGet` tolerates
 * as gone — a dead archer's arrow still lands): **provoke** an otherwise-passive `getAngry` animal
 * ({@link provokeAnger}); **fight XP** ({@link grantFightExperience}) on a **damaging** blow, into the
 * weapon's fight bucket (`weaponMainType`); **cadaver meat** ({@link harvestCadaver}) on a hunter's lethal
 * strike on catchable prey; **stagger** ({@link collectStagger}) when the target **survives** (collected
 * for the deferred `applyPendingStaggers` the caller runs after its loop). A felled target isn't
 * staggered (it's being reaped). Pure over entity state; no RNG/wall-clock.
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
  const health = world.tryGet(target, Health);
  if (health === undefined) return; // target gone / non-combatant — the blow struck nothing (a miss)
  // A MELEE blow that connected: announce it at the victim so render bleeds it and audio plays the
  // weapon-impact SFX. Ranged hits do NOT emit this — the `projectileSystem` announces its own
  // `projectileHit`, the render/audio twin of a melee connect (so a shot never double-fires). A swing
  // at air returned above, so `combatHit` fires only on a real connect (the "miss = no blood" rule). A
  // fully-mitigated (0-damage) connect still cues here by design — the blade touched, so it clangs + marks.
  if (source === 'melee') {
    const at = world.tryGet(target, Position);
    if (at !== undefined) {
      ctx.events.emit({
        kind: 'combatHit',
        attacker,
        target,
        at: eventAt(at.x, at.y),
        ...(weaponMainType !== undefined ? { weaponMainType } : {}),
      });
    }
  }
  // A hit that connected (the target had a pool) AND did harm — the condition the fight-XP + stagger
  // follow-ups need. Computed BEFORE the drain so an overkill still counts as a damaging blow.
  const dealtDamage = damage > 0;
  // The inner `Math.max(0, damage)` guards against a malformed (negative) hit *healing* the target;
  // the outer floors the pool itself (a hit never drives it below 0).
  health.hitpoints = Math.max(0, health.hitpoints - Math.max(0, damage));
  provokeAnger(world, ctx, target);
  if (dealtDamage) grantFightExperience(world, ctx, attacker, weaponMainType); // train the weapon class
  if (health.hitpoints <= 0) {
    harvestCadaver(world, ctx, attacker, target); // a lethal blow may yield meat — no flinch (dying)
  } else {
    collectStagger(world, ctx, target, pendingStaggers); // a survivor may flinch (applied after the loop)
  }
}
