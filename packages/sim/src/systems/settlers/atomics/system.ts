import {
  AtomicClock,
  atomicElapsed,
  CoinDrillOrder,
  CurrentAtomic,
  DeferredOrder,
  endIdleStreak,
  HarvestFocus,
  needsEnabled,
  Resting,
  removeCurrentAtomic,
  Settler,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { System, SystemContext } from '../../context.js';
import { religionAllowsClip } from '../../lifecycle/needs/religion.js';
import { WHOLE_CLIP } from '../../progression/index.js';
import { atomicClip, eventTick, eventTickWithin } from '../../readviews/animations.js';
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
import { atomicSchedule, NO_ATOMIC } from './schedule.js';
import { emitAtomicSoundCues } from './sound-cue.js';
import {
  armStrokeFollowThrough,
  armStrokeRest,
  holdHarvestStance,
  rememberHarvestNode,
  strokeTakeUp,
} from './stroke-cadence.js';

/**
 * Advance the running `CurrentAtomic`s and apply each one's effect on completion. Only the atomics with
 * something to do this tick are visited ({@link atomicSchedule}), in the store's insertion order.
 */
export const atomicSystem: System = (world, ctx) => {
  // A blow's reaction is collected so the pass never starts or ends another settler's atomic mid-walk;
  // self-removal on completion stays the only membership change.
  const pendingReactions: PendingHitReaction[] = [];
  // A rule only a command changes, so it holds for the whole pass.
  const needsOn = needsEnabled(world);
  const schedule = atomicSchedule(world);
  schedule.begin(ctx.tick, ctx.content);
  for (let e = schedule.next(); e !== NO_ATOMIC; e = schedule.next()) {
    advanceAtomic(world, ctx, e, needsOn, pendingReactions);
    schedule.settle(e);
  }
  applyPendingHitReactions(world, pendingReactions);
};

/** Run one tick of `e`'s atomic: its checks, the events its clip authors on this tick, and its end. */
function advanceAtomic(
  world: World,
  ctx: SystemContext,
  e: Entity,
  needsOn: boolean,
  pendingReactions: PendingHitReaction[],
): void {
  let clock = world.get(e, AtomicClock);
  if ('pendingElapsed' in clock) {
    clock = { startedAt: ctx.tick - 1 - clock.pendingElapsed };
    world.add(e, AtomicClock, clock);
    endIdleStreak(world, e);
  }
  const elapsed = atomicElapsed(clock, ctx.tick);
  const running = world.get(e, CurrentAtomic);
  if (
    running.effect.kind === 'pray' &&
    running.targetEntity !== null &&
    !prayerSiteAvailable(world, ctx, e, running.targetEntity as Entity)
  ) {
    removeCurrentAtomic(world, e);
    return;
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
    return;
  }

  // Each authored attack event lands at its frame. Only a swing with no bound clip uses the
  // completion fallback; a bound clip with no attack event is a visual feint.
  if (running.effect.kind === 'attack') {
    const frames = running.effect.hitFrames;
    let struck = false;
    if (frames === undefined) {
      struck = elapsed === duration;
      if (struck) resolveAttackHit(world, ctx, e, running, running.effect, pendingReactions, WHOLE_CLIP);
    } else {
      // Indexed, with no closure: every swing in flight asks this every tick.
      for (let i = 0; i < frames.length; i++) {
        if (elapsed !== eventTickWithin(frames[i] as number, duration)) continue;
        struck = true;
        const share = { event: i, events: frames.length };
        resolveAttackHit(world, ctx, e, running, running.effect, pendingReactions, share);
      }
    }
    const lunge = running.effect.lunge;
    if (lunge !== undefined && lungesOn(lunge.frames, elapsed)) lungeForward(world, ctx, e, lunge.direction);
    // A blow may have rewritten the striker's identity, so its clip is joined again after one.
    if (struck) {
      settler = world.tryGet(e, Settler);
      clip = settler === undefined ? undefined : atomicClip(ctx.content, settler, running.atomicId);
    }
  }

  // A coin drill's clip runs only for the order that paid for it; its coin and points are the term's.
  if (
    running.effect.kind === 'coinDrill' &&
    world.tryGet(e, CoinDrillOrder)?.house !== running.effect.house
  ) {
    removeCurrentAtomic(world, e);
    return;
  }
  // A drink borrows the eat clip, and the draught pays instead of the clip's food events.
  if (needsOn && !workshopDisplay && running.effect.kind !== 'drink' && settler !== undefined)
    applyClipNeedEvents(world, ctx, e, settler, clip, elapsed);
  // Tested here: only a slaughter clip deposits, and the pass is too large for the call to inline.
  if (running.effect.kind === 'slay') applyAtomicStockEvents(world, ctx, e, running, elapsed);
  emitAtomicSoundCues(world, ctx, e, running, elapsed, clip);

  if (elapsed < duration) return;
  const completedAtomicId = running.atomicId;
  // A prayer that goes on restarts its clock alone: its record stays as it is, so it is not acquired.
  if (running.effect.kind === 'pray' && continuesPrayer(world, ctx, e, completedAtomicId)) {
    world.add(e, AtomicClock, { startedAt: ctx.tick });
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: completedAtomicId });
    return;
  }
  const atomic = world.mut(e, CurrentAtomic);
  if (atomic.effect.kind === 'fish') {
    const continues = advanceFishingAtomic(world, ctx, e, atomic, atomic.effect);
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: completedAtomicId });
    if (continues) return;
    removeCurrentAtomic(world, e);
    return;
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
        return;
      }
    } else if (takeUp === 'inPlace') {
      holdHarvestStance(world, ctx, e, node);
    } else if (world.has(e, HarvestFocus)) {
      world.remove(e, HarvestFocus);
    }
  } else if (atomic.effect.kind === 'harvestFollowThrough' && !parked) {
    armStrokeRest(world, ctx, e, atomic);
    world.add(e, AtomicClock, { startedAt: ctx.tick });
    return;
  }
  removeCurrentAtomic(world, e);
}

/** Whether one of a lunge's `frames` fires on tick `elapsed` of its swing. */
function lungesOn(frames: readonly number[], elapsed: number): boolean {
  for (let i = 0; i < frames.length; i++) {
    if (eventTick(frames[i] as number) === elapsed) return true;
  }
  return false;
}
