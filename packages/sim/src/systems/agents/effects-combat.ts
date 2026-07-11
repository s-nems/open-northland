import {
  Anger,
  Carrying,
  CurrentAtomic,
  Health,
  Position,
  Projectile,
  Settler,
} from '../../components/index.js';
import type { AtomicEffect } from '../../core/commands.js';
import { eventAt } from '../../core/events.js';
import { type Fixed, ONE, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { grantFightExperience } from '../progression.js';
import { atomicAnimationName, atomicDuration } from '../readviews/animations.js';
import {
  ATOMIC_EVENT_CHANNEL,
  HUNTER_JOB,
  MEAT_GOOD,
  angryGameTimeOf,
  atomicEventChannelDelta,
  cadaverYieldOf,
  isAggressiveAnimal,
  isCatchableAnimal,
  isInterruptibleAtomic,
  isProvokableAnimal,
} from '../readviews/index.js';
import { entityNode, manhattan } from '../spatial.js';
import { addCarry } from './effects-goods.js';

// The COMBAT-HIT effects of the atomic executor — the mid-animation blow (melee and projectile),
// the deferred-stagger contract, the swing's need cost, cadaver harvesting and provoked anger.

/**
 * The numeric atomic id a struck combatant runs to **flinch** — the original's `setatomic <job> 82
 * "..._attacked"` slot (id 82 = the ATTACKED/stagger slot). Among the **playable** civilizations only
 * the civilian classes bind it (`viking_woman_attacked` / `viking_civilist_attacked`, length 50, no
 * events — playable soldiers/heroes have no 82 row); the **monster tribes** (weresnake/werewolf/
 * bear-weresnake) also bind it for their creature-soldier classes (`DataCnmd/tribetypes12/tribetypes.ini`),
 * so a struck were-monster flinches too — the data-driven design working, not a special case. Purely
 * visual: the atomic carries an `idle` effect (no state mutation), it just occupies the victim so a
 * struck combatant visibly staggers and can't act for its duration. A class with no 82 binding (a
 * playable soldier) never staggers, with zero per-job code.
 */
const ATTACKED_ATOMIC_ID = 82;

/**
 * The original's per-need **reserve span** the raw `event <at> <channel> <delta>` need tuples move
 * against (~10000 in the source — the scale the needs/eat rows document, e.g. a meal `event 30 2 +4000`
 * refills ~40% of it; see `lifecycle/needs.ts` / `agents/drives-needs.ts`). The sim's 0..ONE need bar maps onto
 * it, so a raw reserve delta `D` becomes a bar delta `D / NEED_EVENT_RESERVE · ONE`. **Approximated**:
 * the exact reserve max isn't readable (source basis) — the combat-swing drain preserves the data's
 * DIRECTION (a drain raises the need) and RELATIVE magnitude (a woman's −100 swing costs 5× a soldier's
 * −20), scaled onto the bar; the general event-driven needs drive stays deferred.
 */
const NEED_EVENT_RESERVE = 10000;

/** One deferred stagger: give `victim` the ATTACKED (`82`) flinch atomic for `duration` ticks. Collected
 *  at HIT time ({@link collectStagger}), applied only AFTER the hit loop ({@link applyPendingStaggers}) —
 *  the shared shape both the melee ({@link atomicSystem}) and ranged (`projectileSystem`) hit passes use. */
export interface PendingStagger {
  readonly victim: Entity;
  readonly duration: number;
}

/**
 * Apply a hit pass's collected {@link PendingStagger}s — give each struck survivor its ATTACKED (`82`)
 * flinch atomic. **Deferred** past the pass's own loop on purpose: adding a `CurrentAtomic` to the store
 * the melee pass is iterating would let a victim visited later advance its own fresh stagger this same
 * tick (Map iteration visits a key inserted during iteration), an order-coupling; deferring makes the
 * flinch provably begin advancing the NEXT tick, independent of iteration order. `world.add` overwrites
 * any interruptible action the victim was still running (it was vetted interruptible at hit time — a blow
 * knocks it off task). Two hits on one victim this tick push the same idempotent flinch; last-wins is
 * harmless (identical atomic). Called by {@link atomicSystem} (melee) and the projectileSystem (ranged).
 */
export function applyPendingStaggers(world: World, pendingStaggers: readonly PendingStagger[]): void {
  for (const { victim, duration } of pendingStaggers) {
    world.add(victim, CurrentAtomic, {
      atomicId: ATTACKED_ATOMIC_ID,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
  }
}

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
 *    gets an {@link Anger} timer so it fights back (the `animaltypes.ini` provoked-anger half; an
 *    already-`aggressive` animal needs none — source basis "Civ-vs-animal aggression").
 *  - **Fight XP** ({@link grantFightExperience}) on a **damaging** swing — accrues into the swinging
 *    weapon's fight bucket (keyed by `effect.weaponMainType`), the same expType space the soldier-class
 *    `needfor*` gates read. A 0-damage or missed swing trains nothing.
 *  - **Cadaver meat** ({@link harvestCadaver}) when the blow is **lethal** AND a hunter's strike on
 *    catchable prey — the `harvest_cadaver` payoff.
 *  - **Stagger** ({@link applyStagger}) when the target **survives** — a struck civilian visibly
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
    true, // a melee blow — announce the connect (`combatHit`) for the blood/impact cue
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
 * for the deferred {@link applyPendingStaggers} the caller runs after its loop). A felled target isn't
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
  melee = false,
): void {
  const health = world.tryGet(target, Health);
  if (health === undefined) return; // target gone / non-combatant — the blow struck nothing (a miss)
  // A MELEE blow that connected: announce it at the victim so render bleeds it and audio plays the
  // weapon-impact SFX. Ranged hits do NOT emit this — the `projectileSystem` announces its own
  // `projectileHit`, the render/audio twin of a melee connect (so a shot never double-fires). A swing
  // at air returned above, so `combatHit` fires only on a real connect (the "miss = no blood" rule).
  if (melee) {
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

/**
 * Launch a {@link Projectile} at the shooter's ATTACK-event frame — the ranged branch of a swing (a bow
 * loosing an arrow, a catapult a rock). Creates a bare entity at the shooter's current cell carrying the
 * projectile payload (the pre-resolved `damage`, the target it homes on, the weapon class for fight XP,
 * the ammo class + travel `speed`) and announces it (`projectileLaunched`) for render/audio. The
 * `projectileSystem` then flies it and lands the same {@link resolveCombatHit} on contact.
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

/**
 * Decide — at HIT time — whether a struck **survivor** flinches, and if so COLLECT it for the deferred
 * `world.add` the executor does after its loop (see `atomicSystem`). The flinch is the original's
 * `setatomic <job> 82 "..._attacked"` ATTACKED atomic ({@link ATTACKED_ATOMIC_ID}) — a `CurrentAtomic`
 * carrying an **`idle`** effect (no state mutation) for the ATTACKED animation's length, purely visual
 * occupancy (the struck victim visibly staggers and can't act for its duration, then frees up).
 *
 * **Purely data-driven — no per-job code:** a class flinches iff its `(tribe, job)` binds atomic 82.
 * Among the *playable* civilizations only the civilian classes do (woman/civilist); the monster tribes
 * (weresnake/werewolf/bear-weresnake) also bind it for their creature-soldier classes, which therefore
 * stagger too — that is the design working, not a special case. A class with no 82 binding (a playable
 * soldier/hero) never flinches.
 *
 * Only flags an **interruptible** current action (checked HERE, at the hit, not at the deferred add):
 * a victim mid-swing or already mid-flinch (both `interruptable 0` in the data) is NOT re-staggered —
 * no stunlock, and its own uninterruptible action plays out. An idle victim (no `CurrentAtomic`) always
 * flinches. The deferred add then overwrites whatever interruptible action remains (a blow knocks the
 * victim off task).
 */
export function collectStagger(
  world: World,
  ctx: SystemContext,
  target: Entity,
  pendingStaggers: PendingStagger[],
): void {
  const victim = world.tryGet(target, Settler);
  if (victim === undefined) return; // not a settler/animal — nothing to stagger
  const staggerAnim = atomicAnimationName(ctx.content, victim, ATTACKED_ATOMIC_ID);
  if (staggerAnim === undefined) return; // this class has no `82` binding — it doesn't flinch (data-driven)
  // Don't cut short an uninterruptible action (the victim's own attack swing, or an in-progress flinch).
  const current = world.tryGet(target, CurrentAtomic);
  if (current !== undefined) {
    const currentAnim = atomicAnimationName(ctx.content, victim, current.atomicId);
    // An unresolved current animation is treated as non-interruptible (the `isInterruptibleAtomic`
    // safe default) — don't preempt an action with no timing record.
    if (currentAnim === undefined || !isInterruptibleAtomic(ctx.content, currentAnim)) return;
  }
  pendingStaggers.push({ victim: target, duration: atomicDuration(ctx.content, victim, ATTACKED_ATOMIC_ID) });
}

/**
 * Make an attacker pay a completed swing's **need cost** — the attack animation's REST/HUNGER channel
 * drains, applied to the attacker's `fatigue`/`hunger`. Reads the exact animation that just played
 * (resolved through the atomic's `atomicId`) and sums its {@link ATOMIC_EVENT_CHANNEL.REST}/`HUNGER`
 * `event <at> <channel> <delta>` tuples ({@link atomicEventChannelDelta}) — a soldier swing carries
 * `event 2 1 -20` + `event 2 2 -20` (−20 each), a woman/civilist swing −100. The raw RESERVE delta is
 * scaled onto the sim's 0..ONE need bar ({@link NEED_EVENT_RESERVE}) and **subtracted** from the need:
 * a negative reserve delta (a drain) *raises* the need (`fatigue`/`hunger` climb toward the top of the
 * bar), so fighting tires and hungers the attacker. Clamped to `[0, ONE]` (the need-bar invariant).
 *
 * No-ops when the attacker is gone/jobless or its attack animation doesn't resolve / carries no drain
 * (delta 0). The first combat consumer of the extracted event deltas — scoped to combat atomics; the
 * general event-driven needs drive (replacing the approximated per-tick rise/reset) stays deferred
 * (source basis).
 */
export function paySwingNeedCost(world: World, ctx: SystemContext, attacker: Entity, atomicId: number): void {
  const s = world.tryGet(attacker, Settler);
  if (s === undefined) return; // attacker gone
  const animation = atomicAnimationName(ctx.content, s, atomicId);
  if (animation === undefined) return; // no attack animation to read a drain from
  const restDelta = atomicEventChannelDelta(ctx.content, animation, ATOMIC_EVENT_CHANNEL.REST);
  const hungerDelta = atomicEventChannelDelta(ctx.content, animation, ATOMIC_EVENT_CHANNEL.HUNGER);
  s.fatigue = clampNeed(fx.sub(s.fatigue, reserveDeltaToBar(restDelta)));
  s.hunger = clampNeed(fx.sub(s.hunger, reserveDeltaToBar(hungerDelta)));
}

/** Scale a raw need-event RESERVE delta (`event <at> <channel> <delta>`; negative drains the reserve)
 *  onto the sim's 0..ONE need bar — `delta / NEED_EVENT_RESERVE · ONE`. Subtracting the result from a
 *  need turns a reserve drain (negative delta) into a need rise. `fx.div` truncates toward zero. */
function reserveDeltaToBar(reserveDelta: number): Fixed {
  return fx.div(fx.fromInt(reserveDelta), fx.fromInt(NEED_EVENT_RESERVE));
}

/** Clamp a need value to the `[0, ONE]` bar invariant (the same bound `needsSystem` keeps). */
function clampNeed(value: Fixed): Fixed {
  if (value < 0) return fx.fromInt(0);
  if (value > ONE) return ONE;
  return value;
}

/**
 * The hunter's `harvest_cadaver` payoff — when a **hunter**'s lethal blow fells **catchable prey**, the
 * slayer gains the kill's meat onto its back. Models the original's `viking_hunter_attack` →
 * `viking_hunter_harvest_cadaver` (`setatomic 15 33 …`) chain *in place on the killing blow*: a hunter
 * ({@link HUNTER_JOB}) who drains a {@link isCatchableAnimal} prey animal to 0 gains
 * {@link cadaverYieldOf} units (the prey's `maximumcadaversize`) of {@link MEAT_GOOD} via the same
 * {@link addCarry} carriers use — goods are conserved (the meat is created by the kill, exactly as the
 * original's harvest atomic yields it; the corpse leaves the field when `cleanupSystem` reaps it).
 *
 * No-ops unless every condition holds: the `attacker` is a hunter, the `target` is catchable prey, and
 * the yield is positive (a `maximumcadaversize` of 0 / a non-animal yields nothing). One guard worth
 * naming: {@link addCarry} THROWS if the hunter already carries a *different* good (a planner bug for a
 * harvester, but a fighting hunter never should) — so if the hunter is somehow already loaded with
 * another good, the meat is dropped (skipped) rather than crashing the tick; a hunter carrying meat
 * already merges the new units.
 *
 * source-basis: the meat **good** and **per-kill amount** are pinned params (the `meat` id + the prey's
 * `maximumcadaversize`); that the yield lands *on the killing blow* rather than via a separate
 * walk-to-corpse `harvest_cadaver` atomic, and the 1-cadaver-unit→1-meat-unit mapping, are approximated
 * (source basis "Hunter cadaver-harvest yield"). Pure over `content` + entity state, no RNG/wall-clock.
 */
function harvestCadaver(world: World, ctx: SystemContext, attacker: Entity, target: Entity): void {
  const hunter = world.tryGet(attacker, Settler);
  if (hunter === undefined || hunter.jobType !== HUNTER_JOB) return; // only a hunter harvests a cadaver
  const prey = world.tryGet(target, Settler);
  if (prey === undefined || !isCatchableAnimal(ctx.content, prey.tribe)) return; // only catchable prey
  const cadaverYield = cadaverYieldOf(ctx.content, prey.tribe);
  if (cadaverYield <= 0) return; // no readable cadaver size — nothing to harvest
  // If the hunter is somehow already carrying a DIFFERENT good, `addCarry` would throw (its harvester-bug
  // guard). A fighting hunter shouldn't be, but skip rather than crash the tick on that edge.
  const held = world.tryGet(attacker, Carrying);
  if (held !== undefined && held.goodType !== MEAT_GOOD) return;
  addCarry(world, attacker, MEAT_GOOD, cadaverYield);
}

/**
 * Provoke a struck **passive but `getAngry`** animal into temporary hostility — the provoked half of
 * `animaltypes.ini` aggression. If `target` is a {@link Settler} of a {@link isProvokableAnimal}
 * tribe, stamp/refresh an {@link Anger}`{until: tick + angryGameTime}` on it (`combatSystem` reads
 * the timer to make it fight back until it lapses). A re-strike before the timer expires **refreshes**
 * `until` (the latest provocation extends hostility, the original's "kept angry while harassed"
 * reading). No-ops for a non-`Settler` target, a non-animal/non-provokable tribe (a civilization, an
 * already-`aggressive` bear, an unknown tribe), or an `angryGameTime` of 0 (no readable duration → no
 * lasting anger). Pure of RNG/wall-clock — `until` is the integer `ctx.tick + angryGameTimeOf(...)`.
 */
function provokeAnger(world: World, ctx: SystemContext, target: Entity): void {
  const settler = world.tryGet(target, Settler);
  if (settler === undefined) return; // not a settler/animal — nothing to anger
  if (!isProvokableAnimal(ctx.content, settler.tribe)) return; // not a getAngry animal — no provocation
  // An ALREADY-aggressive animal needs no anger timer — it is hostile unconditionally, and stamping a
  // redundant `Anger` on it would leak a stale component `hostileAnimalNow` never reaps (it short-circuits
  // on `isAggressiveAnimal` before reading `Anger`). Only a passive getAngry animal is provoked.
  if (isAggressiveAnimal(ctx.content, settler.tribe)) return;
  const duration = angryGameTimeOf(ctx.content, settler.tribe);
  if (duration <= 0) return; // no readable anger duration — nothing to time
  const until = ctx.tick + duration;
  const anger = world.tryGet(target, Anger);
  if (anger === undefined) world.add(target, Anger, { until });
  else anger.until = until; // re-strike refreshes the timer (latest provocation wins)
}
