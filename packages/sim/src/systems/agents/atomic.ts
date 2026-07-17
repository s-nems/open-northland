import { CurrentAtomic, ownerOf, Settler } from '../../components/index.js';
import type { AtomicEffect } from '../../core/atomic-effect.js';
import { assertNever } from '../../core/brand.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { advanceConstructionLabor } from '../economy/construction.js';
import { applySow, applyWater } from '../economy/farming.js';
import { grantWorkExperience } from '../progression/index.js';
import {
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  atomicAnimationName,
  atomicEventFrame,
} from '../readviews/animations.js';
import { erectSignpost } from '../signposts/index.js';
import {
  applyPendingStaggers,
  type PendingStagger,
  paySwingNeedCost,
  resolveAttackHit,
} from './effects-combat/index.js';
import {
  beginRestTail,
  consumeFood,
  continuesHarvest,
  dropCarriedLoad,
  endRestTail,
  forageBerry,
  harvestFromNode,
  pickupFromStore,
  pileupIntoStore,
} from './effects-goods/index.js';

/**
 * AtomicSystem — the executor half of the settler planner: advance the {@link CurrentAtomic} a
 * settler is running and, on completion, apply its typed {@link AtomicEffect}.
 *
 * Each tick, for every entity with a CurrentAtomic, the integer `elapsed` counter advances; a `duration` of
 * D ticks completes on the D-th tick (a 0/1-tick animation completes the first tick — `duration` is clamped
 * to at least 1). Timing is the exact integer compare `elapsed >= duration`, not an accumulated fixed-point
 * step: `ONE / duration` truncates, so summing it `duration` times would fall short of ONE and the atomic
 * would hang. `progress` (0..ONE) is recomputed each tick as a derived display value for render
 * interpolation only. When the atomic completes the executor applies the effect, emits an `atomicCompleted`
 * event for render/audio, and removes the component — the planner reads an entity with no CurrentAtomic as
 * ready for its next.
 *
 * `applyEffect` is an exhaustive switch over the {@link AtomicEffect} union (`assertNever` makes a
 * new variant a compile error here), so behavior is the typed effect, not an opaque atomicId. The
 * harvest→pickup→carry→pileup chain that the single-settler slice needs is implemented; `produce`
 * belongs to ProductionSystem and only signals completion here for now.
 *
 * `attack` is the exception to "apply on completion": a swing lands its blow mid-animation at the
 * ATTACK-event frame (`resolveAttackHit` — drains the target's {@link Health}, trains the weapon's fight XP,
 * staggers a struck civilian), and the attacker pays the swing's need cost on completion
 * (`paySwingNeedCost`). A survivor is re-targeted next idle tick, so swings repeat at the animation's
 * cadence. Targeting/who-attacks-whom lives in the CombatSystem.
 */
export const atomicSystem: System = (world, ctx) => {
  // A landed hit may stagger its victim (give it the `82` ATTACKED atomic). That `world.add` is collected
  // here and applied only after the loop: adding a `CurrentAtomic` to the store being iterated would let a
  // victim later in iteration advance its own fresh stagger this same tick (Map iteration visits a key
  // inserted during iteration). Deferring the add makes the flinch provably begin advancing the next tick,
  // independent of `CurrentAtomic` insertion order, and lets the loop iterate the store's live view
  // (self-removal on completion is the only in-loop store mutation, which Map iteration allows). The
  // eligibility check (binding + interruptibility) is still made at hit time (in `collectStagger`), so a
  // victim mid-uninterruptible-swing is never flinched.
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

    // A construction swing plays its authored hammer knock MID-animation at the PLAY_SOUND_FX frame,
    // so the sound lands on the visual strike instead of trailing to swing completion. This emits a
    // sound-only event (no state mutation — resolved from content, so it moves no golden); audio drives
    // the per-swing hammer off it. Only `construct` carries the cue today; other atomics still sound at
    // completion (`atomicCompleted`).
    if (atomic.effect.kind === 'construct') {
      const soundFrame = atomicSoundFrame(world, ctx, e, atomic.atomicId);
      if (soundFrame !== undefined && atomic.elapsed === Math.min(Math.max(1, soundFrame), duration)) {
        ctx.events.emit({ kind: 'atomicSound', entity: e, atomicId: atomic.atomicId });
      }
    }

    if (atomic.elapsed < duration) continue; // still running

    // A finished REST TAIL: its harvest already applied and announced itself when the swing finished
    // (below, last time around). Chain STRAIGHT into the next swing while the job still stands (a
    // competitor may have finished the node mid-rest) — re-arming the SAME atomic keeps the settler
    // continuously acting, so the render never flicks through an idle pose between swings.
    if (atomic.restTail === true) {
      if (atomic.effect.kind === 'harvest' && continuesHarvest(world, atomic.effect.resource)) {
        endRestTail(atomic); // back to the swing's own length and pre-rest component shape
        atomic.elapsed = 0;
        atomic.progress = fx.fromInt(0);
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
    // A multi-swing harvest job never releases the settler between swings, since the one-tick planner gap
    // draws an idle-pose flick mid-work: a swing on the burst boundary holds the same atomic open as the
    // breather tail (`beginRestTail` — the render holds the ready pose), any other still-in-progress swing
    // re-arms immediately, and only the swing that fells / chips a unit loose / depletes hands the settler
    // back to the planner (it routes the pickup/carry). Mutating in place (never remove+add) keeps this
    // iteration-safe.
    if (atomic.effect.kind === 'harvest') {
      if (beginRestTail(world, atomic, atomic.effect.resource)) continue;
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
 * The tick within a settler's atomic animation at which it plays its PLAY_SOUND_FX cue (the frame the
 * original triggers the action's sound — the hammer knock on the builder's visual strike), or undefined
 * when the animation carries no such event. Resolved from content: the settler's tribe binds the atomic to
 * an animation whose `event <at> 34` gives the frame ({@link ATOMIC_EVENT_TYPE_PLAY_SOUND_FX}). The
 * {@link contentIndex} maps it resolves through are memoized, so the per-tick lookup over the few active
 * construction swings is O(1) each.
 */
function atomicSoundFrame(world: World, ctx: SystemContext, e: Entity, atomicId: number): number | undefined {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined) return undefined;
  const anim = atomicAnimationName(ctx.content, settler, atomicId);
  return anim === undefined
    ? undefined
    : atomicEventFrame(ctx.content, anim, ATOMIC_EVENT_TYPE_PLAY_SOUND_FX);
}

/**
 * Apply a completed atomic's effect. Exhaustive over {@link AtomicEffect}: adding a variant is a compile
 * error until it is handled here (`assertNever`).
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
      // Recreation clears enjoyment (free, like sleeping/praying), closing the NeedsSystem's
      // rise→enjoy→reset loop. The satisfier drive is deferred — `enjoy` has no readable building
      // satisfier — so no planner branch chooses it yet.
      if (world.has(settler, Settler)) world.get(settler, Settler).enjoyment = fx.fromInt(0);
      return;
    case 'make_love':
      // The make_love atomic (id 78) is not a separate need: its animation restores the same channel 3 as
      // `enjoy` (`event <at> 3 +800`), so it resets `enjoyment` too. Its drive is deferred for the same
      // reason as `enjoy` — no readable building satisfier.
      if (world.has(settler, Settler)) world.get(settler, Settler).enjoyment = fx.fromInt(0);
      return;
    case 'move':
    case 'idle':
      // Pure markers: the actual walking is the navigation layer (PathFollow/MovementSystem). The
      // atomic just completing is the signal; no extra state change.
      return;
    case 'attack':
      // The blow already landed mid-animation at the ATTACK-event frame (the loop's `resolveAttackHit`),
      // so nothing applies on completion. The swing's need-drain is paid in the loop right after this call
      // (`paySwingNeedCost`) — it lives there because it needs the atomic's id to resolve the animation
      // that just played.
      return;
    case 'produce':
      // Owned by ProductionSystem (a later slice). Completing the atomic + emitting the event is
      // enough for now; the heavy mutation lands when that system exists.
      return;
    case 'erectSignpost': {
      // The scout's completed build-guide swing raises the signpost at the target node — instant and
      // free (one strike). Re-validated inside erectSignpost: a spot taken mid-swing whiffs (no post).
      const terrain = ctx.terrain;
      const player = ownerOf(world, settler);
      if (terrain !== undefined && player !== undefined) {
        erectSignpost(world, ctx, terrain, terrain.nodeAt(effect.x, effect.y), player);
      }
      return;
    }
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
    case 'drop':
      // Set the carried load on the ground so the interrupting action proceeds empty-handed (see
      // dropCarriedLoad for the own-tile-then-spill placement). A settler carrying nothing is a no-op.
      dropCarriedLoad(world, ctx.terrain, settler);
      return;
    default:
      assertNever(effect); // a new AtomicEffect variant is a compile error until handled above
  }
}
