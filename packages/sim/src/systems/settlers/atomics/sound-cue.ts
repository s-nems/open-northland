import type { AtomicAnimation } from '@open-northland/data';
import { isWildlife, Settler } from '../../../components/index.js';
import type { AtomicEffect } from '../../../core/atomic-effect.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import {
  atomicAnimationByName,
  atomicClip,
  boundAnimalAtomicAnimation,
  clipEventFactsOf,
} from '../../readviews/animations.js';

/** The running atomic a cue lookup reads - its join key, its length, and the effect that tells whether
 *  its clip plays at its own pace or stretched over the atomic. */
export interface SoundingAtomic {
  readonly atomicId: number;
  readonly duration: number;
  readonly effect?: { readonly kind: AtomicEffect['kind'] };
}

/** An atomic whose clip plays once over its whole length, shortened or stretched to fit, so its cues
 *  ride that scaled clock: a lift into or out of a hold, whose length the cart's kind sets, and a craft,
 *  which plays over its workplace's batch. */
function scalesClip(kind: AtomicEffect['kind'] | undefined): boolean {
  return (
    kind === 'produce' ||
    kind === 'haulLoad' ||
    kind === 'haulUnload' ||
    kind === 'tradeLoad' ||
    kind === 'tradeUnload' ||
    kind === 'tradeShipStow' ||
    kind === 'tradeShipFetch'
  );
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
  return soundingClipOf(world, ctx, settler, atomic, atomicClip(ctx.content, s, atomic.atomicId));
}

/** {@link soundingClip} for a settler whose {@link atomicClip} is already resolved as `clip`. */
function soundingClipOf(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
  clip: AtomicAnimation | undefined,
): AtomicAnimation | undefined {
  let anim = clip;
  if (isWildlife(world, settler)) {
    const s = world.get(settler, Settler);
    const name = boundAnimalAtomicAnimation(ctx.content, s, atomic.atomicId);
    anim = name === undefined ? undefined : atomicAnimationByName(ctx.content, name);
  }
  if (anim === undefined) return undefined;
  return atomic.duration < anim.length && !scalesClip(atomic.effect?.kind) ? undefined : anim;
}

/** Whether this atomic's clip sounds itself, so no engine-chosen sound is wanted for it. */
export function atomicClipSounds(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
): boolean {
  const anim = soundingClip(world, ctx, settler, atomic);
  return anim !== undefined && clipEventFactsOf(anim).soundCues.length > 0;
}

/**
 * Emit the sound cues a settler's running atomic authors on this tick: every `event <at> 34 <id>` row of
 * its clip landing on `elapsed` (`eventTick`), carrying `<id>` as the sound bank's `logicSoundType`.
 * A clip authoring no such row is silent. `clip` is the settler's resolved {@link atomicClip}.
 */
export function emitAtomicSoundCues(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: SoundingAtomic,
  elapsed: number,
  clip: AtomicAnimation | undefined,
): void {
  const anim = soundingClipOf(world, ctx, settler, atomic, clip);
  if (anim === undefined) return;
  const scaled = scalesClip(atomic.effect?.kind) && atomic.duration > 0;
  const now = scaled ? Math.floor((elapsed * anim.length) / atomic.duration) : elapsed;
  const before = scaled ? Math.floor(((elapsed - 1) * anim.length) / atomic.duration) : elapsed - 1;
  const sip = atomic.effect?.kind === 'drink';
  for (const cue of clipEventFactsOf(anim).soundCues) {
    if (cue.tick > before && cue.tick <= now)
      ctx.events.emit({
        kind: 'atomicSound',
        entity: settler,
        soundType: cue.soundType,
        ...(sip ? { sip: true as const } : {}),
      });
  }
}
