import { AtomicClock, CurrentAtomic, DeferredOrder, removeCurrentAtomic } from '../../../components/index.js';
import type { System } from '../../context.js';
import { applyEffect } from './effects/apply.js';
import {
  applyPendingHitReactions,
  type PendingHitReaction,
  resolveAttackHit,
} from './effects/combat/index.js';
import { advanceFishingAtomic } from './effects/goods/fishing.js';
import { beginRestTail, continuesHarvest, endRestTail } from './effects/goods/index.js';
import { applyAtomicNeedEvents } from './effects/need-events.js';
import { applyAtomicStockEvents } from './effects/stock-events.js';
import { emitAtomicSoundCues } from './sound-cue.js';

/** Advance every running `CurrentAtomic` and apply its effect on completion. */
export const atomicSystem: System = (world, ctx) => {
  // A blow's reaction is collected so the loop never touches the CurrentAtomic store it iterates;
  // self-removal on completion stays the only membership change, which Map iteration tolerates.
  const pendingReactions: PendingHitReaction[] = [];
  for (const e of world.query(CurrentAtomic)) {
    // Only the clock is written every tick; the atomic itself is acquired for writing at a boundary.
    const clock = world.mut(e, AtomicClock);
    clock.elapsed += 1;
    const elapsed = clock.elapsed;
    const running = world.get(e, CurrentAtomic);
    const duration = Math.max(1, running.duration);

    // An attack lands mid-animation at its `hitAt` frame, the follow-through then playing out to
    // `duration`. `elapsed` equals the clamped frame exactly once, so one swing lands one blow.
    if (running.effect.kind === 'attack') {
      const hitFrame = eventFrameWithin(running.effect.hitAt ?? duration, duration);
      if (elapsed === hitFrame) {
        resolveAttackHit(world, ctx, e, running, running.effect, pendingReactions);
      }
    }

    applyAtomicNeedEvents(world, ctx, e, running, elapsed);
    applyAtomicStockEvents(world, ctx, e, running, elapsed);
    emitAtomicSoundCues(world, ctx, e, running, elapsed);

    if (elapsed < duration) continue;
    const atomic = world.mut(e, CurrentAtomic);

    // A finished rest tail already applied and announced its harvest, so it chains straight into the next
    // swing; the node is re-checked because a competitor may have finished it mid-rest.
    if (atomic.restTail === true) {
      if (
        atomic.effect.kind === 'harvest' &&
        !world.has(e, DeferredOrder) && // a parked order releases the settler at the swing boundary
        continuesHarvest(world, atomic.effect.resource)
      ) {
        endRestTail(atomic);
        clock.elapsed = 0;
        continue;
      }
      removeCurrentAtomic(world, e);
      continue;
    }

    const completedAtomicId = atomic.atomicId;
    if (atomic.effect.kind === 'fish') {
      const continues = advanceFishingAtomic(world, ctx, e, atomic, atomic.effect);
      ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: completedAtomicId });
      if (continues) continue;
      removeCurrentAtomic(world, e);
      continue;
    }
    const extracted = applyEffect(world, ctx, e, atomic);
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: completedAtomicId });
    // A multi-swing harvest holds the settler across swings, re-arming in place so this iteration stays
    // safe; only the swing that extracts hands it back to the planner. "Non-interruptible" protects the
    // swing in flight, not the whole job, so a parked order releases the settler at this boundary.
    if (atomic.effect.kind === 'harvest' && (extracted ?? 0) === 0 && !world.has(e, DeferredOrder)) {
      if (beginRestTail(world, atomic, atomic.effect.resource)) continue;
      if (continuesHarvest(world, atomic.effect.resource)) {
        clock.elapsed = 0;
        continue;
      }
    }
    removeCurrentAtomic(world, e);
  }

  applyPendingHitReactions(world, pendingReactions);
};

/** Clamp an animation's event frame into the `[1, duration]` ticks the atomic actually runs, so a blow the
 *  data puts past the animation length still lands exactly once, on the last tick. */
function eventFrameWithin(frame: number, duration: number): number {
  return Math.min(Math.max(1, frame), duration);
}
