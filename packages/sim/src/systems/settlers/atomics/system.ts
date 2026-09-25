import {
  AtomicClock,
  CurrentAtomic,
  DeferredOrder,
  HarvestFocus,
  removeCurrentAtomic,
} from '../../../components/index.js';
import type { System } from '../../context.js';
import { applyEffect } from './effects/apply.js';
import {
  applyPendingHitReactions,
  type PendingHitReaction,
  resolveAttackHit,
} from './effects/combat/index.js';
import { advanceFishingAtomic } from './effects/goods/fishing.js';
import { continuesHarvest } from './effects/goods/index.js';
import { applyAtomicNeedEvents } from './effects/need-events.js';
import { applyAtomicStockEvents } from './effects/stock-events.js';
import { emitAtomicSoundCues } from './sound-cue.js';
import { armStrokeFollowThrough, armStrokeRest, rememberHarvestNode } from './stroke-cadence.js';

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
    // A counted stroke that leaves its node part-worked runs the stroke cadence, re-arming in place so
    // this iteration stays safe; the stroke that extracts hands the settler straight back to the planner.
    // "Non-interruptible" protects the clip in flight, not the whole job, so a parked order releases the
    // settler at either boundary.
    const parked = world.has(e, DeferredOrder);
    if (atomic.effect.kind === 'harvest') {
      if ((extracted ?? 0) === 0 && continuesHarvest(world, atomic.effect.resource)) {
        rememberHarvestNode(world, e, atomic.effect.resource);
        if (!parked) {
          armStrokeFollowThrough(atomic, clock, atomic.effect.resource);
          continue;
        }
      } else if (world.has(e, HarvestFocus)) {
        world.remove(e, HarvestFocus);
      }
    } else if (atomic.effect.kind === 'harvestFollowThrough' && !parked) {
      armStrokeRest(world, ctx, e, atomic, clock);
      continue;
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
