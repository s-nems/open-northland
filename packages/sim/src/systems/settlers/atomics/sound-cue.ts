import { Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import {
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  atomicAnimationName,
  atomicEventFrame,
} from '../../readviews/animations.js';

/** The frame in a settler's atomic animation carrying its PLAY_SOUND_FX cue, or undefined when the tribe
 *  binds the atomic to no animation or that animation has no such event. */
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
