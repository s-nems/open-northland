import {
  Anger,
  Carrying,
  CurrentAtomic,
  Felling,
  GroundDrop,
  Health,
  Position,
  Projectile,
  Resource,
  Settler,
  Stockpile,
  Stump,
} from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { AtomicEffect } from '../../core/commands.js';
import { type Fixed, ONE, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { grantFightExperience, grantWorkExperience } from '../progression.js';
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
import { atomicAnimationName, atomicDuration, stockCapacity } from '../shared.js';

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
 * refills ~40% of it; see `lifecycle/needs.ts` / `conflict/ai.ts`). The sim's 0..ONE need bar maps onto
 * it, so a raw reserve delta `D` becomes a bar delta `D / NEED_EVENT_RESERVE · ONE`. **Approximated**:
 * the exact reserve max isn't readable (docs/FIDELITY.md) — the combat-swing drain preserves the data's
 * DIRECTION (a drain raises the need) and RELATIVE magnitude (a woman's −100 swing costs 5× a soldier's
 * −20), scaled onto the bar; the general event-driven needs drive stays deferred.
 */
const NEED_EVENT_RESERVE = 10000;

/**
 * AtomicSystem — the executor half of the settler planner: advance the {@link CurrentAtomic} a
 * settler is running and, on completion, apply its typed {@link AtomicEffect}.
 *
 * Each tick, for every entity with a CurrentAtomic, the integer `elapsed` counter advances; a
 * `duration` of D ticks completes on the D-th tick (a 0/1-tick animation completes the first tick —
 * `duration` is clamped to at least 1). Timing is the exact integer compare `elapsed >= duration`,
 * NOT an accumulated fixed-point step: `ONE / duration` truncates, so summing it `duration` times
 * would fall short of ONE and the atomic would hang. `progress` (0..ONE) is recomputed each tick as
 * a derived display value for render interpolation only. When the atomic completes the executor
 * applies the effect (the state mutation), emits an `atomicCompleted` event for render/audio, and
 * removes the component — the planner reads an entity with no CurrentAtomic as ready for its next.
 *
 * `applyEffect` is an exhaustive switch over the {@link AtomicEffect} union (`assertNever` makes a
 * new variant a compile error here), so behavior is the typed effect, not an opaque atomicId. The
 * harvest→pickup→carry→pileup chain that the single-settler slice needs is implemented; `produce`
 * belongs to ProductionSystem and only signals completion here for now.
 *
 * **`attack` is the exception to "apply on completion":** a swing lands its blow MID-animation at the
 * ATTACK-event frame (`resolveAttackHit` — drains the target's {@link Health}, trains the weapon's
 * fight XP, staggers a struck civilian), and the attacker pays the swing's need cost on completion
 * (`paySwingNeedCost`). A survivor is re-targeted next idle tick, so swings repeat at the animation's
 * cadence. This is the combat behavior; targeting/who-attacks-whom lives in the CombatSystem.
 *
 * Determinism: no RNG, no wall-clock. Entities are visited in the CurrentAtomic store's deterministic
 * insertion order, and each effect is a pure function of the entity + its target's current state
 * (Stockpile writes go through the canonical Map, never iterated for a decision). Fixed-point only.
 */
export const atomicSystem: System = (world, ctx) => {
  // A landed hit may STAGGER its victim (give it the `82` ATTACKED atomic). That `world.add` is
  // COLLECTED here and applied only AFTER the loop: adding a `CurrentAtomic` to the store we're
  // iterating would let a victim later in iteration advance its own fresh stagger this same tick (a
  // real order-coupling — Map iteration visits a key inserted during iteration). Deferring the add makes
  // the flinch provably begin advancing the NEXT tick, independent of `CurrentAtomic` insertion order,
  // and lets the loop iterate the store's live view (self-removal on completion is the only in-loop
  // store mutation, which Map iteration allows). The eligibility check (binding + interruptibility) is
  // still made at HIT time (in `collectStagger`), so a victim mid-uninterruptible-swing is never flinched.
  const pendingStaggers: PendingStagger[] = [];
  for (const e of world.query(CurrentAtomic)) {
    const atomic = world.get(e, CurrentAtomic);
    const duration = Math.max(1, atomic.duration);
    atomic.elapsed += 1;
    // Derived 0..ONE display value (render interpolation); clamped so it never exceeds ONE.
    atomic.progress = fx.div(fx.fromInt(Math.min(atomic.elapsed, duration)), fx.fromInt(duration));

    // An attack lands its blow MID-animation at the ATTACK-event frame (`hitAt`), not at completion —
    // a spear thrust connects partway through its swing, the follow-through then playing out to
    // `duration`. When the animation carries no ATTACK event (`hitAt` absent) the hit falls back to the
    // completion frame. `elapsed` steps through every integer, so it equals the (clamped) frame exactly
    // once — the swing lands a single blow.
    if (atomic.effect.kind === 'attack') {
      const hitFrame = Math.min(Math.max(1, atomic.effect.hitAt ?? duration), duration);
      if (atomic.elapsed === hitFrame) resolveAttackHit(world, ctx, e, atomic.effect, pendingStaggers);
    }

    if (atomic.elapsed < duration) continue; // still running

    // Completed this tick: apply the effect, notify render/audio, and free the settler.
    applyEffect(world, ctx, e, atomic.effect);
    // An attacker pays the swing's NEED cost on completion — the attack animation's REST/HUNGER channel
    // drains (`event <at> {1,2} <delta>`), resolved through the atomic's own id (so it stays scoped to
    // combat and reads the exact animation that just played). Done here, not in `applyEffect`, because
    // it needs the atomic id to resolve that animation.
    if (atomic.effect.kind === 'attack') paySwingNeedCost(world, ctx, e, atomic.atomicId);
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: atomic.atomicId });
    world.remove(e, CurrentAtomic);
  }

  // Apply the collected flinches now — the `CurrentAtomic` store is no longer being iterated (see
  // `applyPendingStaggers` for why the add is deferred).
  applyPendingStaggers(world, pendingStaggers);
};

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
 * Apply a completed atomic's effect. Exhaustive over {@link AtomicEffect}: adding a variant is a
 * compile error until it is handled here (`assertNever`). Each branch is a pure function of current
 * state — no RNG, no wall-clock.
 */
function applyEffect(world: World, ctx: SystemContext, settler: Entity, effect: AtomicEffect): void {
  switch (effect.kind) {
    case 'harvest':
      // Two harvest shapes, keyed by the node's own {@link Felling} component (data, not a goodType
      // check): a FELLABLE node (a tree) is chopped down over several swings and drops its whole yield
      // as a ground trunk; a single-hit node (stone/clay) yields one unit onto the back and drains by
      // one. See {@link harvestFromNode}. Goods are conserved either way (nothing teleports).
      harvestFromNode(world, ctx, settler, effect.resource, effect.goodType);
      // Completing a work atomic that yields a good trains the settler's `(job, good)` specialization
      // — the original grants XP within a narrow `(job, good)` track, not just per job (see
      // ProgressionSystem). No-op when the job/good pairing has no track.
      grantWorkExperience(world, ctx, settler, effect.goodType);
      return;
    case 'pickup':
      pickupFromStore(world, settler, effect.from, effect.goodType, effect.amount);
      return;
    case 'pileup':
      pileupIntoStore(world, ctx, settler, effect.store);
      return;
    case 'eat':
      // Eating consumes one unit of food (from a store the eater stands on, or its own carried load)
      // and clears hunger. Goods are conserved up to that consumption — the food is destroyed, never
      // conjured: if the source has nothing left (it emptied between the planner choosing it and the
      // swing completing) no unit is removed, but hunger still resets (the bite was taken).
      consumeFood(world, settler, effect.from, effect.goodType);
      if (world.has(settler, Settler)) world.get(settler, Settler).hunger = fx.fromInt(0);
      return;
    case 'sleep':
      // Resting clears fatigue (no goods consumed — sleeping is free, unlike eating). Pairs with the
      // NeedsSystem's per-tick fatigue rise to close the rise→sleep→reset loop.
      if (world.has(settler, Settler)) world.get(settler, Settler).fatigue = fx.fromInt(0);
      return;
    case 'pray':
      // Praying clears piety (no goods consumed — like sleeping, devotion is free). Pairs with the
      // NeedsSystem's per-tick piety rise to close the rise→pray→reset loop. The walk to a temple is
      // the planner's job (a target-bound need); by the time this fires the settler is standing on one.
      if (world.has(settler, Settler)) world.get(settler, Settler).piety = fx.fromInt(0);
      return;
    case 'enjoy':
      // Recreation clears enjoyment (no goods consumed — like sleeping/praying, leisure is free).
      // Pairs with the NeedsSystem's per-tick enjoyment rise to close the rise→enjoy→reset loop. The
      // satisfier *drive* (where this is run) is deferred — `enjoy` has no readable building satisfier
      // (see docs/FIDELITY.md) — so no planner branch chooses it yet; the reset is wired and ready.
      if (world.has(settler, Settler)) world.get(settler, Settler).enjoyment = fx.fromInt(0);
      return;
    case 'make_love':
      // Making love also clears enjoyment (no goods consumed — like enjoy). The make_love atomic
      // (id 78) is not a separate need: its animation restores the SAME channel 3 as `enjoy`
      // (`event <at> 3 +800` tuples), the leisure bar — so it resets `enjoyment` too. The drive is
      // deferred for the same reason as `enjoy` (no readable building satisfier — see docs/FIDELITY.md);
      // no planner branch chooses it yet, the reset is wired and ready.
      if (world.has(settler, Settler)) world.get(settler, Settler).enjoyment = fx.fromInt(0);
      return;
    case 'move':
    case 'idle':
      // Pure markers: the actual walking is the navigation layer (PathFollow/MovementSystem). The
      // atomic just completing is the signal; no extra state change.
      return;
    case 'attack':
      // The blow itself already landed MID-animation at the ATTACK-event frame (the executor loop's
      // `resolveAttackHit`), so there is nothing to apply on completion here. The attacker's swing
      // NEED-DRAIN is paid in the loop right after this call (`paySwingNeedCost`) — it lives there, not
      // in this switch, because it needs the atomic's id to resolve the animation that just played.
      return;
    case 'produce':
      // Owned by ProductionSystem (a later slice). Completing the atomic + emitting the event is
      // enough for now; the heavy mutation lands when that system exists.
      return;
    default:
      assertNever(effect); // a new AtomicEffect variant is a compile error until handled above
  }
}

/**
 * Units a single completed `harvest` atomic yields — granted to the settler AND removed from the
 * harvested node. One unit per swing keeps the node draining in step with what gets carried away,
 * so goods are conserved (a node of N units survives exactly N harvests). A real per-good yield
 * (some nodes drop more per swing) is a later balance slice — kept a constant so tuning is a diff.
 */
const HARVEST_YIELD = 1;

/**
 * Resolve one completed harvest swing, in one of two shapes decided by the node's own {@link Felling}
 * component (never a hardcoded goodType — the felling lifecycle is content-declared and stamped on the
 * node at spawn):
 *
 *  - **Fellable node** (a tree, `Felling` present): the swing is a CHOP — it drives the node one step
 *    toward falling and grants NOTHING onto the settler's back. The whole yield lands at once as a
 *    ground trunk when the node comes down ({@link fellNode}, on the chop that zeroes `chopsLeft`), for
 *    the collector to carry off. This is the multi-hit harvest + drop-on-ground the ROADMAP names.
 *  - **Single-hit node** (stone/clay/…, no `Felling`): the swing grants {@link HARVEST_YIELD} of
 *    `goodType` onto the settler's back and depletes the node by the same amount (clamped at 0), so the
 *    node releases exactly what is carried away. (Step 4 reworks these into per-unit ground drops.)
 *
 * A missing {@link Resource} means the node was already felled/destroyed between the swing starting and
 * completing (another collector beat this one to it) — the swing hit nothing, so it yields nothing;
 * goods stay conserved (no unit is conjured for a chop that landed on air).
 */
function harvestFromNode(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  node: Entity,
  goodType: number,
): void {
  const res = world.tryGet(node, Resource);
  if (res === undefined) return; // node already felled/gone — the swing struck nothing (conserved)
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) {
    felling.chopsLeft -= 1;
    if (felling.chopsLeft <= 0) fellNode(world, ctx, node, res.goodType, res.remaining);
    return;
  }
  addCarry(world, settler, goodType, HARVEST_YIELD);
  res.remaining = Math.max(0, res.remaining - HARVEST_YIELD);
}

/**
 * Fell a {@link Felling} node whose last chop just landed: remove the standing node (so the planner
 * never re-scans a depleted stump-to-be — the fix for the old "skip a `remaining <= 0` node forever"),
 * drop its whole `yield` at its cell as a bare {@link Stockpile} trunk pile (a {@link GroundDrop} the
 * collector then carries off, consumed by the unchanged pickup/porter/delivery machinery), leave a
 * {@link Stump} decor where it stood, and announce it (`resourceFelled`) for render/audio. Goods are
 * conserved — the trunk holds exactly what the standing node was worth, nothing created or lost by the
 * tree coming down. The node's `goodType`/`yield` are read BEFORE the destroy (the component object is
 * dropped from its store by `world.destroy`). Pure over entity state; no RNG/wall-clock.
 */
function fellNode(world: World, ctx: SystemContext, node: Entity, goodType: number, yield_: number): void {
  const pos = world.get(node, Position);
  const { x, y } = pos;
  // The felled wood: a ground trunk pile holding the whole yield, at the node's cell — the pickup/
  // delivery machinery already handles a bare Stockpile+Position, the GroundDrop marker scopes the
  // collector's own-trunk drive + the emptied-pile cleanup (see reapEmptyGroundDrop).
  const trunk = world.create();
  world.add(trunk, Position, { x, y });
  world.add(trunk, Stockpile, { amounts: new Map([[goodType, yield_]]) });
  world.add(trunk, GroundDrop, { goodType });
  // The stump / debris left where the tree stood — pure decor (non-blocking, not harvestable).
  const stump = world.create();
  world.add(stump, Position, { x, y });
  world.add(stump, Stump, { goodType });
  // The standing node is gone from every planner scan from here on.
  world.destroy(node);
  ctx.events.emit({
    kind: 'resourceFelled',
    node,
    trunk,
    stump,
    goodType,
    amount: yield_,
    at: { x: fx.toInt(x), y: fx.toInt(y) },
  });
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
 *    already-`aggressive` animal needs none — docs/FIDELITY.md "Civ-vs-animal aggression").
 *  - **Fight XP** ({@link grantFightExperience}) on a **damaging** swing — accrues into the swinging
 *    weapon's fight bucket (keyed by `effect.weaponMainType`), the same expType space the soldier-class
 *    `needfor*` gates read. A 0-damage or missed swing trains nothing.
 *  - **Cadaver meat** ({@link harvestCadaver}) when the blow is **lethal** AND a hunter's strike on
 *    catchable prey — the `harvest_cadaver` payoff.
 *  - **Stagger** ({@link applyStagger}) when the target **survives** — a struck civilian visibly
 *    flinches (its data-driven `82` ATTACKED atomic), if interruptible. A felled target isn't staggered
 *    (it's being reaped); a soldier/animal with no `82` binding never flinches.
 */
function resolveAttackHit(
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
  resolveCombatHit(
    world,
    ctx,
    attacker,
    effect.target,
    effect.damage,
    effect.weaponMainType,
    pendingStaggers,
  );
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
): void {
  const health = world.tryGet(target, Health);
  if (health === undefined) return; // target gone / non-combatant — the blow struck nothing
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
function launchProjectile(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
): void {
  if (effect.projectile === undefined) return; // not a ranged swing (defensive — the caller gates this)
  const from = world.tryGet(attacker, Position);
  if (from === undefined) return; // shooter vanished mid-draw — no shot
  if (world.tryGet(effect.target, Health) === undefined) return; // target already gone — loose at nothing
  const shot = world.create();
  world.add(shot, Position, { x: from.x, y: from.y });
  world.add(shot, Projectile, {
    source: attacker,
    target: effect.target,
    damage: effect.damage,
    weaponMainType: effect.weaponMainType ?? null,
    munitionType: effect.projectile.munitionType,
    speed: effect.projectile.speed,
  });
  ctx.events.emit({
    kind: 'projectileLaunched',
    projectile: shot,
    shooter: attacker,
    target: effect.target,
    munitionType: effect.projectile.munitionType,
    at: { x: fx.toInt(from.x), y: fx.toInt(from.y) },
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
function collectStagger(
  world: World,
  ctx: SystemContext,
  target: Entity,
  pendingStaggers: PendingStagger[],
): void {
  const victim = world.tryGet(target, Settler);
  if (victim === undefined) return; // not a settler/animal — nothing to stagger
  const staggerAnim = atomicAnimationName(ctx, victim, ATTACKED_ATOMIC_ID);
  if (staggerAnim === undefined) return; // this class has no `82` binding — it doesn't flinch (data-driven)
  // Don't cut short an uninterruptible action (the victim's own attack swing, or an in-progress flinch).
  const current = world.tryGet(target, CurrentAtomic);
  if (current !== undefined) {
    const currentAnim = atomicAnimationName(ctx, victim, current.atomicId);
    // An unresolved current animation is treated as non-interruptible (the `isInterruptibleAtomic`
    // safe default) — don't preempt an action with no timing record.
    if (currentAnim === undefined || !isInterruptibleAtomic(ctx.content, currentAnim)) return;
  }
  pendingStaggers.push({ victim: target, duration: atomicDuration(ctx, victim, ATTACKED_ATOMIC_ID) });
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
 * (docs/FIDELITY.md).
 */
function paySwingNeedCost(world: World, ctx: SystemContext, attacker: Entity, atomicId: number): void {
  const s = world.tryGet(attacker, Settler);
  if (s === undefined) return; // attacker gone
  const animation = atomicAnimationName(ctx, s, atomicId);
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
 * FIDELITY: the meat **good** and **per-kill amount** are pinned params (the `meat` id + the prey's
 * `maximumcadaversize`); that the yield lands *on the killing blow* rather than via a separate
 * walk-to-corpse `harvest_cadaver` atomic, and the 1-cadaver-unit→1-meat-unit mapping, are approximated
 * (docs/FIDELITY.md "Hunter cadaver-harvest yield"). Pure over `content` + entity state, no RNG/wall-clock.
 */
function harvestCadaver(world: World, ctx: SystemContext, attacker: Entity, target: Entity): void {
  const hunter = world.tryGet(attacker, Settler);
  if (hunter === undefined || hunter.jobType !== HUNTER_JOB) return; // only a hunter harvests a cadaver
  const prey = world.tryGet(target, Settler);
  if (prey === undefined || !isCatchableAnimal(ctx.content, prey.tribe)) return; // only catchable prey
  const yield_ = cadaverYieldOf(ctx.content, prey.tribe);
  if (yield_ <= 0) return; // no readable cadaver size — nothing to harvest
  // If the hunter is somehow already carrying a DIFFERENT good, `addCarry` would throw (its harvester-bug
  // guard). A fighting hunter shouldn't be, but skip rather than crash the tick on that edge.
  const held = world.tryGet(attacker, Carrying);
  if (held !== undefined && held.goodType !== MEAT_GOOD) return;
  addCarry(world, attacker, MEAT_GOOD, yield_);
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

/**
 * Resolve one completed `pickup`: move up to `amount` of `goodType` from a source store's
 * {@link Stockpile} onto the settler's back. Goods are conserved — the carrier gains exactly what
 * the source loses, so a pickup never creates or destroys goods (carriers haul; nothing teleports).
 * When `from` is null (a sourceless pickup) the goods simply appear carried; otherwise the available
 * amount caps the transfer (the source may have shrunk between the planner choosing it and the swing
 * completing — a competing system or another carrier). A source with nothing left to give is a no-op.
 */
function pickupFromStore(
  world: World,
  settler: Entity,
  from: Entity | null,
  goodType: number,
  amount: number,
): void {
  if (from === null) {
    addCarry(world, settler, goodType, amount);
    return;
  }
  const stock = world.tryGet(from, Stockpile);
  if (stock === undefined) return; // source gone — nothing to take (don't conjure goods)
  const have = stock.amounts.get(goodType) ?? 0;
  const moved = Math.min(amount, have);
  if (moved <= 0) return; // source emptied since the planner chose it — nothing to carry
  stock.amounts.set(goodType, have - moved);
  addCarry(world, settler, goodType, moved);
  reapEmptyGroundDrop(world, from); // a fully-collected felled trunk vanishes (a designated flag stays)
}

/**
 * Reap a bare {@link GroundDrop} pile (a felled trunk / dropped-good heap) once a pickup has emptied it,
 * so a long game doesn't accrete an empty pile per felled tree. Only a `GroundDrop` is auto-removed — a
 * *designated* delivery flag (an equally-bare `Stockpile` with no marker) persists as a collection
 * point. The emptiness test reads the `amounts` for a pure "holds nothing" predicate (not an
 * order-dependent choice), so raw Map iteration is fine here. No-op for a non-drop / still-stocked pile.
 */
function reapEmptyGroundDrop(world: World, pile: Entity): void {
  if (!world.has(pile, GroundDrop)) return; // a designated flag / building store — never auto-reaped
  const stock = world.tryGet(pile, Stockpile);
  if (stock === undefined) return;
  for (const amount of stock.amounts.values()) if (amount > 0) return; // still holds something
  world.destroy(pile);
}

/**
 * Consume one unit of `goodType` food for an `eat` atomic: from the store `from` (a stockpile the
 * eater stands on) when given, else from the settler's own carried load. Goods are conserved — a unit
 * is removed only if one is actually present (the source may have emptied since the planner chose it,
 * or the carried load was deposited mid-swing); a missing source/empty slot is a no-op (no negative
 * stock, nothing conjured). The carried good fully consumed has its {@link Carrying} removed.
 */
function consumeFood(world: World, settler: Entity, from: Entity | null, goodType: number): void {
  if (from !== null) {
    const stock = world.tryGet(from, Stockpile);
    if (stock === undefined) return; // source gone — nothing to consume
    const have = stock.amounts.get(goodType) ?? 0;
    if (have <= 0) return; // emptied since the planner chose it — eat anyway, but take nothing
    stock.amounts.set(goodType, have - 1);
    return;
  }
  // No store: consume from the settler's own carried load.
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.goodType !== goodType || load.amount <= 0) return;
  if (load.amount > 1) load.amount -= 1;
  else world.remove(settler, Carrying); // last unit eaten — no longer carrying anything
}

/**
 * Add `amount` of `goodType` to a settler's carried load, merging if it already carries that good.
 *
 * A settler carries one good at a time (single-slot {@link Carrying}). Asking it to pick up a
 * *different* good while still loaded would silently overwrite — and so destroy — the held good,
 * breaking goods conservation. That can only be a planner bug (the planner must pile up the current
 * load first), so we throw rather than corrupt state (CLAUDE.md: throw for bugs).
 */
function addCarry(world: World, settler: Entity, goodType: number, amount: number): void {
  const held = world.tryGet(settler, Carrying);
  if (held !== undefined) {
    if (held.goodType !== goodType) {
      throw new Error(
        `settler ${settler} already carries good ${held.goodType}; cannot pick up good ${goodType} (pile up first)`,
      );
    }
    held.amount += amount;
    return;
  }
  world.add(settler, Carrying, { goodType, amount });
}

/**
 * Deposit a settler's carried load into a store's {@link Stockpile}, capped at the building type's
 * per-good capacity. Any overflow stays on the settler's back (goods are conserved — never dropped).
 * No-op if the settler carries nothing or the store has no stockpile.
 */
function pileupIntoStore(world: World, ctx: SystemContext, settler: Entity, store: Entity): void {
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return;
  const stock = world.tryGet(store, Stockpile);
  if (stock === undefined) return;

  const have = stock.amounts.get(load.goodType) ?? 0;
  const capacity = stockCapacity(world, ctx, store, load.goodType);
  const space = Math.max(0, capacity - have);
  const moved = Math.min(load.amount, space);
  if (moved <= 0) return; // store full for this good — keep carrying

  stock.amounts.set(load.goodType, have + moved);
  const remaining = load.amount - moved;
  if (remaining > 0) load.amount = remaining;
  else world.remove(settler, Carrying); // fully unloaded
}
