import {
  AtomicClock,
  atomicElapsed,
  CurrentAtomic,
  DeferredOrder,
  HarvestFocus,
  needsEnabled,
  Resting,
  removeCurrentAtomic,
  Settler,
} from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
import type { System } from '../../context.js';
import { religionAllowsClip } from '../../lifecycle/needs/religion.js';
import { atomicClip, eventTick } from '../../readviews/animations.js';
import { prayerSiteAvailable } from '../../readviews/prayer-sites.js';
import { applyEffect } from './effects/apply.js';
import {
  applyPendingHitReactions,
  lungeForward,
  type PendingHitReaction,
  resolveAttackHit,
} from './effects/combat/index.js';
import { advanceFishingAtomic } from './effects/goods/fishing.js';
import { continuesHarvest } from './effects/goods/index.js';
import { applyClipNeedEvents } from './effects/need-events.js';
import { applyAtomicStockEvents } from './effects/stock-events.js';
import { continuesPrayer } from './prayer.js';
import { emitAtomicSoundCues } from './sound-cue.js';
import {
  armStrokeFollowThrough,
  armStrokeRest,
  holdHarvestStance,
  rememberHarvestNode,
  strokeTakeUp,
} from './stroke-cadence.js';

/** Advance every running `CurrentAtomic` and apply its effect on completion. */
export const atomicSystem: System = (world, ctx) => {
  // A blow's reaction is collected so the loop never touches the CurrentAtomic store it iterates;
  // self-removal on completion stays the only membership change, which Map iteration tolerates.
  const pendingReactions: PendingHitReaction[] = [];
  // A rule only a command changes, so it holds for the whole pass.
  const needsOn = needsEnabled(world);
  for (const e of world.query(CurrentAtomic)) {
    let clock = world.get(e, AtomicClock);
    if ('pendingElapsed' in clock) {
      clock = { startedAt: ctx.tick - 1 - clock.pendingElapsed };
      world.add(e, AtomicClock, clock);
    }
    const elapsed = atomicElapsed(clock, ctx.tick);
    const running = world.get(e, CurrentAtomic);
    if (
      running.effect.kind === 'pray' &&
      running.targetEntity !== null &&
      !prayerSiteAvailable(world, ctx, e, running.targetEntity as Entity)
    ) {
      removeCurrentAtomic(world, e);
      continue;
    }
    const duration = Math.max(1, running.duration);
    const workshopDisplay =
      running.effect.kind === 'produce' && world.tryGet(e, Resting)?.at === running.targetEntity;
    let settler = world.tryGet(e, Settler);
    let clip = settler === undefined ? undefined : atomicClip(ctx.content, settler, running.atomicId);
    if (
      needsOn &&
      !workshopDisplay &&
      settler !== undefined &&
      !religionAllowsClip(world, ctx, e, settler, clip, elapsed - 1)
    ) {
      removeCurrentAtomic(world, e);
      continue;
    }

    // Each authored attack event lands at its frame. Only a swing with no bound clip uses the
    // completion fallback; a bound clip with no attack event is a visual feint.
    if (running.effect.kind === 'attack') {
      const frames = running.effect.hitFrames;
      let struck = false;
      if (frames === undefined) {
        struck = elapsed === duration;
        if (struck) resolveAttackHit(world, ctx, e, running, running.effect, pendingReactions);
      } else {
        // Indexed, with no closure: every swing in flight asks this every tick.
        for (let i = 0; i < frames.length; i++) {
          if (elapsed !== eventTickWithin(frames[i] as number, duration)) continue;
          struck = true;
          resolveAttackHit(world, ctx, e, running, running.effect, pendingReactions);
        }
      }
      const lunge = running.effect.lunge;
      if (lunge !== undefined && lungesOn(lunge.frames, elapsed))
        lungeForward(world, ctx, e, lunge.direction);
      // A blow may have rewritten the striker's identity, so its clip is joined again after one.
      if (struck) {
        settler = world.tryGet(e, Settler);
        clip = settler === undefined ? undefined : atomicClip(ctx.content, settler, running.atomicId);
      }
    }

    if (needsOn && !workshopDisplay && settler !== undefined)
      applyClipNeedEvents(world, ctx, e, settler, clip, elapsed);
    // Tested here: only a slaughter clip deposits, and the pass is too large for the call to inline.
    if (running.effect.kind === 'slay') applyAtomicStockEvents(world, ctx, e, running, elapsed);
    emitAtomicSoundCues(world, ctx, e, running, elapsed, clip);

    if (elapsed < duration) continue;
    const completedAtomicId = running.atomicId;
    // A prayer that goes on restarts its clock alone: its record stays as it is, so it is not acquired.
    if (running.effect.kind === 'pray' && continuesPrayer(world, ctx, e, completedAtomicId)) {
      world.add(e, AtomicClock, { startedAt: ctx.tick });
      ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: completedAtomicId });
      continue;
    }
    const atomic = world.mut(e, CurrentAtomic);
    if (atomic.effect.kind === 'fish') {
      const continues = advanceFishingAtomic(world, ctx, e, atomic, atomic.effect);
      ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: completedAtomicId });
      if (continues) continue;
      removeCurrentAtomic(world, e);
      continue;
    }
    const extracted = applyEffect(world, ctx, e, atomic);
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: completedAtomicId });
    // A stroke that leaves its node part-worked takes it up again per `strokeTakeUp`: a follow-through
    // re-arms in place so this iteration stays safe, the other two hand the settler back to the planner,
    // as does the stroke that extracts. "Non-interruptible" protects the clip in flight, not the whole job,
    // so a parked order releases the settler at either boundary.
    const parked = world.has(e, DeferredOrder);
    if (atomic.effect.kind === 'harvest') {
      const node = atomic.effect.resource;
      const takeUp =
        (extracted ?? 0) === 0 && continuesHarvest(world, node)
          ? strokeTakeUp(world, ctx, e, node, atomic.atomicId)
          : 'fresh';
      if (takeUp === 'followThrough') {
        rememberHarvestNode(world, e, node);
        if (!parked) {
          armStrokeFollowThrough(atomic, node);
          world.add(e, AtomicClock, { startedAt: ctx.tick });
          continue;
        }
      } else if (takeUp === 'inPlace') {
        holdHarvestStance(world, ctx, e, node);
      } else if (world.has(e, HarvestFocus)) {
        world.remove(e, HarvestFocus);
      }
    } else if (atomic.effect.kind === 'harvestFollowThrough' && !parked) {
      armStrokeRest(world, ctx, e, atomic);
      world.add(e, AtomicClock, { startedAt: ctx.tick });
      continue;
    }
    removeCurrentAtomic(world, e);
  }

  applyPendingHitReactions(world, pendingReactions);
};

/** Whether one of a lunge's `frames` fires on tick `elapsed` of its swing. */
function lungesOn(frames: readonly number[], elapsed: number): boolean {
  for (let i = 0; i < frames.length; i++) {
    if (eventTick(frames[i] as number) === elapsed) return true;
  }
  return false;
}

/** The tick an animation's event frame fires on, clamped into the `duration` ticks the atomic actually runs.
 *  Approximation: the original never fires a frame past its clip; here such a blow lands once, on the last
 *  tick, so an attack clip authored that way still hits. No shipped clip has one. */
function eventTickWithin(frame: number, duration: number): number {
  return Math.min(eventTick(frame), duration);
}
