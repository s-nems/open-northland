import { Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import {
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  atomicAnimationByName,
  atomicClipName,
  atomicEventTick,
} from '../../readviews/animations.js';

/**
 * Emit the sound cues a settler's running atomic authors on this tick: every `event <at> 34 <id>` row of
 * its animation whose clamped frame is `elapsed`, carrying `<id>` as the sound bank's `logicSoundType`.
 * A clip with no such row is silent, and one with several sounds them all.
 */
export function emitAtomicSoundCues(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomicId: number,
  elapsed: number,
  duration: number,
): void {
  const s = world.tryGet(settler, Settler);
  if (s === undefined) return;
  const clip = atomicClipName(ctx.content, s, atomicId);
  if (clip === undefined) return;
  const anim = atomicAnimationByName(ctx.content, clip);
  if (anim === undefined) return;
  for (const event of anim.events) {
    if (event.type !== ATOMIC_EVENT_TYPE_PLAY_SOUND_FX || event.value === undefined) continue;
    if (atomicEventTick(event.at, duration) !== elapsed) continue;
    ctx.events.emit({ kind: 'atomicSound', entity: settler, soundType: event.value });
  }
}
