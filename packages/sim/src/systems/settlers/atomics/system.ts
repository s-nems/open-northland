import { CurrentAtomic, DeferredOrder } from '../../../components/index.js';
import { fx } from '../../../core/fixed.js';
import type { System } from '../../context.js';
import { applyEffect } from './effects/apply.js';
import {
  applyPendingStaggers,
  type PendingStagger,
  paySwingNeedCost,
  resolveAttackHit,
} from './effects/combat/index.js';
import { beginRestTail, continuesHarvest, endRestTail } from './effects/goods/index.js';
import { atomicSoundFrame } from './sound-cue.js';

/**
 * AtomicSystem - the executor half of the settler planner: advance the {@link CurrentAtomic} a settler is
 * running and, on completion, apply its typed effect ({@link applyEffect}), emit `atomicCompleted` for
 * render/audio, and remove the component - the planner reads an entity with no CurrentAtomic as ready for
 * its next.
 *
 * A `duration` of D ticks completes on the D-th tick (a 0/1-tick animation completes the first tick -
 * `duration` is clamped to at least 1). Timing is the exact integer compare `elapsed >= duration`, not an
 * accumulated fixed-point step: `ONE / duration` truncates, so summing it `duration` times would fall short
 * of ONE and the atomic would hang. `progress` (0..ONE) is a derived display value for render interpolation
 * only, recomputed each tick and clamped so it never exceeds ONE.
 */
export const atomicSystem: System = (world, ctx) => {
  // Staggers from landed hits are collected, not added, while this loop iterates the CurrentAtomic store
  // (see `applyPendingStaggers` for the ordering hazard the deferral removes). Self-removal on completion
  // is then the loop's only change to that store's MEMBERSHIP - the per-tick writes are all in place -
  // which Map iteration allows.
  const pendingStaggers: PendingStagger[] = [];
  for (const e of world.query(CurrentAtomic)) {
    const atomic = world.get(e, CurrentAtomic);
    const duration = Math.max(1, atomic.duration);
    atomic.elapsed += 1;
    atomic.progress = fx.div(fx.fromInt(Math.min(atomic.elapsed, duration)), fx.fromInt(duration));

    // An attack lands its blow MID-animation at the ATTACK-event frame (`hitAt`) - a spear thrust connects
    // partway through its swing, the follow-through then playing out to `duration`. `elapsed` steps through
    // every integer, so it equals the clamped frame exactly once: the swing lands a single blow. Who swings
    // at whom is the CombatSystem's; this is only the landing.
    if (atomic.effect.kind === 'attack') {
      const hitFrame = eventFrameWithin(atomic.effect.hitAt ?? duration, duration);
      if (atomic.elapsed === hitFrame) resolveAttackHit(world, ctx, e, atomic.effect, pendingStaggers);
    }

    // Only `construct` carries a mid-animation sound cue today (the builder's hammer knock on the visual
    // strike); every other atomic sounds at completion. Sound-only - no state mutation, so no golden moves.
    if (atomic.effect.kind === 'construct') {
      const soundFrame = atomicSoundFrame(world, ctx, e, atomic.atomicId);
      if (soundFrame !== undefined && atomic.elapsed === eventFrameWithin(soundFrame, duration)) {
        ctx.events.emit({ kind: 'atomicSound', entity: e, atomicId: atomic.atomicId });
      }
    }

    if (atomic.elapsed < duration) continue; // still running

    // A finished REST TAIL: its harvest applied and announced itself when the swing finished (below, last
    // time around), so it chains straight into the next swing - re-checked, since a competitor may have
    // finished the node mid-rest.
    if (atomic.restTail === true) {
      if (
        atomic.effect.kind === 'harvest' &&
        !world.has(e, DeferredOrder) && // a parked order releases the settler at the swing boundary
        continuesHarvest(world, atomic.effect.resource)
      ) {
        endRestTail(atomic); // back to the swing's own length and pre-rest component shape
        atomic.elapsed = 0;
        atomic.progress = fx.fromInt(0);
        continue;
      }
      world.remove(e, CurrentAtomic);
      continue;
    }

    const extracted = applyEffect(world, ctx, e, atomic);
    // The attacker pays the swing's need cost here rather than in `applyEffect`: it resolves the animation
    // that just played through the atomic's own id, which the effect does not carry.
    if (atomic.effect.kind === 'attack') paySwingNeedCost(world, ctx, e, atomic.atomicId);
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: atomic.atomicId });
    // A multi-swing harvest job holds the settler across swings (see `continuesHarvest`): the swing on a
    // burst boundary stays open as the breather tail, any other in-progress swing re-arms in place (never
    // remove+add, which keeps this iteration safe), and only the swing that EXTRACTS hands the settler back
    // to the planner. A parked order breaks the chain instead: "non-interruptible" protects the swing in
    // flight, not the whole job, so the settler is released at this boundary and the deferredOrderSystem
    // (scheduled next) applies the order.
    if (atomic.effect.kind === 'harvest' && (extracted ?? 0) === 0 && !world.has(e, DeferredOrder)) {
      if (beginRestTail(world, atomic, atomic.effect.resource)) continue;
      if (continuesHarvest(world, atomic.effect.resource)) {
        atomic.elapsed = 0;
        atomic.progress = fx.fromInt(0);
        continue; // next swing, back to back
      }
    }
    world.remove(e, CurrentAtomic);
  }

  applyPendingStaggers(world, pendingStaggers);
};

/** Clamp an animation's event frame into the `[1, duration]` ticks the atomic actually runs, so a cue the
 *  data puts past the (possibly clamped) animation length still fires exactly once, on its last tick. */
function eventFrameWithin(frame: number, duration: number): number {
  return Math.min(Math.max(1, frame), duration);
}
