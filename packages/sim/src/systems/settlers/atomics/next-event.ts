import { type CurrentAtomicState, Settler } from '../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import type { ContentContext } from '../../context.js';
import {
  ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK,
  atomicClip,
  clipEventFactsOf,
  eventTick,
  eventTickWithin,
} from '../../readviews/animations.js';
import { atomicSoundCueTick, soundingClipOf } from './sound-cue.js';

/**
 * The first tick of `e`'s running atomic past `after` (both counted from the clip's start) on which the
 * executor may have something to do: an authored need, sound, stock, hit or lunge frame, a check that
 * reads other state every tick, or the atomic's end. Never later than the first tick that does act, as
 * long as the atomic's record, its clock and the settler's identity stay as they are.
 */
export function nextAtomicEventTick(
  world: World,
  ctx: ContentContext,
  e: Entity,
  running: DeepReadonly<CurrentAtomicState>,
  after: number,
): number {
  const next = after + 1;
  const duration = Math.max(1, running.duration);
  if (next >= duration) return next;
  const effect = running.effect;
  // A prayer asks for its site and a coin drill for its order on every tick.
  if (effect.kind === 'pray' || effect.kind === 'coinDrill') return next;
  let due = duration;
  if (effect.kind === 'attack') {
    const frames = effect.hitFrames;
    if (frames !== undefined) {
      for (let i = 0; i < frames.length; i++) {
        const at = eventTickWithin(frames[i] as number, duration);
        if (at > after && at < due) due = at;
      }
    }
    const lunges = effect.lunge?.frames;
    if (lunges !== undefined) {
      for (let i = 0; i < lunges.length; i++) {
        const at = eventTick(lunges[i] as number);
        if (at > after && at < due) due = at;
      }
    }
  }
  const settler = world.tryGet(e, Settler);
  if (settler === undefined) return due;
  const clip = atomicClip(ctx.content, settler, running.atomicId);
  if (clip !== undefined) {
    const facts = clipEventFactsOf(clip);
    // The religion reserve is read on every tick up to the clip's last spend.
    if (facts.lastPietySpendTick >= next) return next;
    for (const frame of facts.needFrames) {
      const at = replayedEventTick(frame, clip.length, after);
      if (at < due) due = at;
    }
    if (effect.kind === 'slay') {
      for (const event of clip.events) {
        if (event.type !== ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK) continue;
        const at = replayedEventTick(event.at, clip.length, after);
        if (at < due) due = at;
      }
    }
  }
  const sounding = soundingClipOf(world, ctx, e, running, clip);
  if (sounding !== undefined) {
    const cues = clipEventFactsOf(sounding).soundCues;
    for (let i = 0; i < cues.length; i++) {
      const at = atomicSoundCueTick(running, sounding, (cues[i] as { tick: number }).tick);
      if (at > after && at < due) due = at;
    }
  }
  return due;
}

/** The first tick past `after` that fires clip frame `frame` of a clip `length` frames long, which replays
 *  while its atomic runs on; `Infinity` for a frame the clip never reaches. */
function replayedEventTick(frame: number, length: number, after: number): number {
  const first = eventTick(frame);
  if (length <= 0) return first > after ? first : Number.POSITIVE_INFINITY;
  if (frame < 0 || frame >= length) return Number.POSITIVE_INFINITY;
  if (first > after) return first;
  return first + (Math.floor((after - first) / length) + 1) * length;
}
