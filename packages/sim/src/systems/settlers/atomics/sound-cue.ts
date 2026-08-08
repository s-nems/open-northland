import type { AtomicAnimation } from '@open-northland/data';
import { isWildlife, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import {
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  atomicAnimationByName,
  atomicClipName,
  boundAtomicAnimation,
} from '../../readviews/animations.js';

/** The running atomic a cue lookup reads - its join key and the clock it is being played against. */
export interface SoundingAtomic {
  readonly atomicId: number;
  readonly elapsed: number;
  readonly duration: number;
}

/**
 * The clip whose sounds `settler` plays for this atomic, or `undefined` when nothing placeable resolves.
 *
 * Wildlife resolves its own tribe's binding only: the civilist fallback belongs to the human bodies, and a
 * bear must not punch like a civilist. The cue frames index the clip's own clock, so an atomic running
 * shorter than the clip is playing something else - a settler asleep in the `_home` twin of its bound
 * sleep clip - and can place none of them.
 */
function soundingClip(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
): AtomicAnimation | undefined {
  const s = world.tryGet(settler, Settler);
  if (s === undefined) return undefined;
  const name = isWildlife(world, settler)
    ? boundAtomicAnimation(ctx.content, s, atomic.atomicId)
    : atomicClipName(ctx.content, s, atomic.atomicId);
  if (name === undefined) return undefined;
  const anim = atomicAnimationByName(ctx.content, name);
  return anim === undefined || atomic.duration < anim.length ? undefined : anim;
}

/** Whether this atomic's clip sounds itself, so no engine-chosen sound is wanted for it. */
export function atomicClipSounds(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
): boolean {
  const anim = soundingClip(world, ctx, settler, atomic);
  return anim !== undefined && anim.events.some((e) => e.type === ATOMIC_EVENT_TYPE_PLAY_SOUND_FX);
}

/**
 * Emit the sound cues a settler's running atomic authors on this tick: every `event <at> 34 <id>` row of
 * its clip landing on `elapsed`, carrying `<id>` as the sound bank's `logicSoundType`. A clip authoring
 * no such row is silent.
 */
export function emitAtomicSoundCues(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
): void {
  const anim = soundingClip(world, ctx, settler, atomic);
  if (anim === undefined) return;
  for (const event of anim.events) {
    if (event.type !== ATOMIC_EVENT_TYPE_PLAY_SOUND_FX || event.value === undefined) continue;
    if (event.at > anim.length) continue; // authored past its own clip: no frame to land on
    if (Math.max(1, event.at) !== atomic.elapsed) continue; // frame 0 plays on the clip's first tick
    ctx.events.emit({ kind: 'atomicSound', entity: settler, soundType: event.value });
  }
}
