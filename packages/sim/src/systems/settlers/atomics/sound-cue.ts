import { Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import {
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  atomicAnimationName,
  atomicEventFrame,
} from '../../readviews/animations.js';

/**
 * The frame within a settler's atomic animation at which it plays its PLAY_SOUND_FX cue
 * ({@link ATOMIC_EVENT_TYPE_PLAY_SOUND_FX}), or undefined when the settler's tribe binds the atomic to no
 * animation or that animation carries no such event. The content indexes it resolves through are memoized,
 * so the per-tick lookup is O(1) per active swing.
 */
export function atomicSoundFrame(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomicId: number,
): number | undefined {
  const s = world.tryGet(settler, Settler);
  if (s === undefined) return undefined;
  const anim = atomicAnimationName(ctx.content, s, atomicId);
  return anim === undefined
    ? undefined
    : atomicEventFrame(ctx.content, anim, ATOMIC_EVENT_TYPE_PLAY_SOUND_FX);
}
