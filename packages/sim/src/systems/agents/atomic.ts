import { CurrentAtomic, Settler } from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { AtomicEffect } from '../../core/commands.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { advanceConstructionLabor } from '../economy/construction.js';
import { applySow, applyWater } from '../economy/farming.js';
import { grantWorkExperience } from '../progression.js';
import {
  applyPendingStaggers,
  type PendingStagger,
  paySwingNeedCost,
  resolveAttackHit,
} from './effects-combat.js';
import {
  consumeFood,
  continuesHarvest,
  forageBerry,
  harvestFromNode,
  pickupFromStore,
  pileupIntoStore,
  restAfterHarvest,
} from './effects-goods.js';

// Re-exported so the projectile system (and the systems barrel) keep their single import site for
// the shared combat-hit contract after the effects split.
export { applyPendingStaggers, type PendingStagger, resolveCombatHit } from './effects-combat.js';

/**
 * The idle BREATHER a gatherer stands between work-swing BURSTS, in ticks (0.75 s at 20 ticks/s).
 * OBSERVED, a named approximation: the original's collector swings a couple of times in a row, rests
 * ~0.5–1 s, and swings again, but the readable data carries no rest field — `atomicanimations.ini`
 * lengths cover only the swing itself (its trailing idle pad is ~4 frames, far shorter). Applied by
 * the executor after every {@link import('./effects-goods.js').HARVEST_SWINGS_PER_REST}-th completed
 * harvest swing of a job still in progress ({@link import('./effects-goods.js').restAfterHarvest}),
 * never after the final swing (felled/depleted/plucked — the settler moves straight on to carrying).
 * The rest is the SAME atomic extended (`restTail`), not a second one: the render keeps the swing's
 * binding and stands the list's ready stance, so the pose never snaps to a different animation
 * (the earlier synthetic-rest-atomic version flickered through the wait loop mid-follow-through).
 */
export const HARVEST_REST_TICKS = 15;

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

    // A finished REST TAIL: its harvest already applied and announced itself when the swing finished
    // (below, last time around). Chain STRAIGHT into the next swing while the job still stands (a
    // competitor may have finished the node mid-rest) — re-arming the SAME atomic keeps the settler
    // continuously acting, so the render never flicks through an idle pose between swings.
    if (atomic.restTail === true) {
      if (atomic.effect.kind === 'harvest' && continuesHarvest(world, atomic.effect.resource)) {
        delete atomic.restTail; // the tail is over — restore the pre-rest component shape exactly
        atomic.elapsed = 0;
        atomic.progress = fx.fromInt(0);
        atomic.duration -= HARVEST_REST_TICKS; // back to the swing's own animation length
        continue;
      }
      world.remove(e, CurrentAtomic);
      continue;
    }

    // Completed this tick: apply the effect, notify render/audio, and free the settler.
    applyEffect(world, ctx, e, atomic.effect);
    // An attacker pays the swing's NEED cost on completion — the attack animation's REST/HUNGER channel
    // drains (`event <at> {1,2} <delta>`), resolved through the atomic's own id (so it stays scoped to
    // combat and reads the exact animation that just played). Done here, not in `applyEffect`, because
    // it needs the atomic id to resolve that animation.
    if (atomic.effect.kind === 'attack') paySwingNeedCost(world, ctx, e, atomic.atomicId);
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: atomic.atomicId });
    // A multi-swing harvest job never releases the settler between swings (the one-tick planner gap
    // drew an idle-pose flick mid-work): every HARVEST_SWINGS_PER_REST-th swing extends the SAME
    // atomic into the breather tail (the render holds the ready pose — the observed burst rhythm),
    // any other still-in-progress swing re-arms immediately, and only the swing that fells / chips a
    // unit loose / depletes hands the settler back to the planner (it routes the pickup/carry).
    // Mutating IN PLACE (never remove+add) keeps this iteration-safe and deterministic.
    if (atomic.effect.kind === 'harvest') {
      if (HARVEST_REST_TICKS > 0 && restAfterHarvest(world, atomic.effect.resource)) {
        atomic.duration += HARVEST_REST_TICKS;
        atomic.restTail = true;
        continue;
      }
      if (continuesHarvest(world, atomic.effect.resource)) {
        atomic.elapsed = 0;
        atomic.progress = fx.fromInt(0);
        continue; // next swing, back to back
      }
    }
    world.remove(e, CurrentAtomic);
  }

  // Apply the collected flinches now — the `CurrentAtomic` store is no longer being iterated (see
  // `applyPendingStaggers` for why the add is deferred).
  applyPendingStaggers(world, pendingStaggers);
};

/**
 * Apply a completed atomic's effect. Exhaustive over {@link AtomicEffect}: adding a variant is a
 * compile error until it is handled here (`assertNever`). Each branch is a pure function of current
 * state — no RNG, no wall-clock.
 */
function applyEffect(world: World, ctx: SystemContext, settler: Entity, effect: AtomicEffect): void {
  switch (effect.kind) {
    case 'harvest':
      // Three harvest shapes, keyed by the node's own markers (data, not a goodType check): a FELLABLE
      // node ({@link Felling}, a tree) is chopped down over several swings and drops its whole yield as a
      // ground trunk; a MINED node ({@link MineDeposit}, an ore deposit) drops one unit at its cell as an
      // ore pile per swing and shrinks by level; a bare node (a mushroom) yields one unit onto the back.
      // A mined/bare node is REMOVED once drained. See {@link harvestFromNode}. Goods are conserved every
      // shape (nothing teleports; a drained node conjures nothing).
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
    case 'forage':
      // Foraging a wild berry bush: eat its ripe fruit (the bush flips ripe→bare + schedules its regrow,
      // and emits `berryForaged` for the render handover) and zero hunger — the wild-food twin of `eat`,
      // but no stored/carried good is consumed and no job/tool is needed. A bush bare/gone since the
      // planner chose it grants no food but still resets hunger (the bite was taken), like `eat`.
      forageBerry(world, ctx, effect.bush);
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
      // (see source basis) — so no planner branch chooses it yet; the reset is wired and ready.
      if (world.has(settler, Settler)) world.get(settler, Settler).enjoyment = fx.fromInt(0);
      return;
    case 'make_love':
      // Making love also clears enjoyment (no goods consumed — like enjoy). The make_love atomic
      // (id 78) is not a separate need: its animation restores the SAME channel 3 as `enjoy`
      // (`event <at> 3 +800` tuples), the leisure bar — so it resets `enjoyment` too. The drive is
      // deferred for the same reason as `enjoy` (no readable building satisfier — see source basis);
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
    case 'construct':
      // A builder's completed build swing is one hammer STRIKE — advance the site's construction `labor` a
      // small step (several strikes per unit, scaled to size); the ConstructionSystem reflects it into
      // `built`/`Health` and finishes the build once labor + material are both complete. No goods move here
      // (materials are consumed into the structure at completion).
      advanceConstructionLabor(world, ctx, effect.site);
      return;
    case 'sow':
      // A farmer's sowing swing plants a Crop field at the target node (unless it was taken mid-swing —
      // the raced-target no-op). Growing it is the CropGrowthSystem's job; reaping rides `harvest`.
      applySow(world, ctx, effect);
      return;
    case 'water':
      // A farmer's watering (cultivate) marks the field watered — which opens its growth (the gate).
      applyWater(world, effect.crop);
      return;
    default:
      assertNever(effect); // a new AtomicEffect variant is a compile error until handled above
  }
}
