import { CurrentAtomic, DeferredOrder } from '../../../components/index.js';
import { fx } from '../../../core/fixed.js';
import type { System } from '../../context.js';
import { atomicEventTick } from '../../readviews/animations.js';
import { applyEffect } from './effects/apply.js';
import {
  applyPendingStaggers,
  type PendingStagger,
  paySwingNeedCost,
  resolveAttackHit,
} from './effects/combat/index.js';
import { beginRestTail, continuesHarvest, endRestTail } from './effects/goods/index.js';
import { emitAtomicSoundCues } from './sound-cue.js';

/** Advance every running `CurrentAtomic` and apply its effect on completion. */
export const atomicSystem: System = (world, ctx) => {
  // Staggers are collected so the loop never adds to the CurrentAtomic store it iterates; self-removal on
  // completion stays the only membership change, which Map iteration tolerates.
  const pendingStaggers: PendingStagger[] = [];
  for (const e of world.query(CurrentAtomic)) {
    const atomic = world.mut(e, CurrentAtomic);
    const duration = Math.max(1, atomic.duration);
    atomic.elapsed += 1;
    atomic.progress = fx.div(fx.fromInt(Math.min(atomic.elapsed, duration)), fx.fromInt(duration));

    // An attack lands mid-animation at its `hitAt` frame, the follow-through then playing out to
    // `duration`. `elapsed` equals the clamped frame exactly once, so one swing lands one blow.
    if (atomic.effect.kind === 'attack') {
      const hitFrame = atomicEventTick(atomic.effect.hitAt ?? duration, duration);
      if (atomic.elapsed === hitFrame) resolveAttackHit(world, ctx, e, atomic.effect, pendingStaggers);
    }

    emitAtomicSoundCues(world, ctx, e, atomic.atomicId, atomic.elapsed, duration);

    if (atomic.elapsed < duration) continue;

    // A finished rest tail already applied and announced its harvest, so it chains straight into the next
    // swing; the node is re-checked because a competitor may have finished it mid-rest.
    if (atomic.restTail === true) {
      if (
        atomic.effect.kind === 'harvest' &&
        !world.has(e, DeferredOrder) && // a parked order releases the settler at the swing boundary
        continuesHarvest(world, atomic.effect.resource)
      ) {
        endRestTail(atomic);
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
    // A multi-swing harvest holds the settler across swings, re-arming in place so this iteration stays
    // safe; only the swing that extracts hands it back to the planner. "Non-interruptible" protects the
    // swing in flight, not the whole job, so a parked order releases the settler at this boundary.
    if (atomic.effect.kind === 'harvest' && (extracted ?? 0) === 0 && !world.has(e, DeferredOrder)) {
      if (beginRestTail(world, atomic, atomic.effect.resource)) continue;
      if (continuesHarvest(world, atomic.effect.resource)) {
        atomic.elapsed = 0;
        atomic.progress = fx.fromInt(0);
        continue;
      }
    }
    world.remove(e, CurrentAtomic);
  }

  applyPendingStaggers(world, pendingStaggers);
};
