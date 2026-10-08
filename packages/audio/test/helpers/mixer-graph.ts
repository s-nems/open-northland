import type { SoundBus } from '../../src/index.js';
import type { FakeContext, FakeGain } from './fake-audio.js';

/** The engine's mixer nodes, by the order it creates its gains: the master, the buses in
 *  `SOUND_BUSES` order, then the music duck. */
export interface MixerGraph {
  readonly master: FakeGain;
  readonly buses: Readonly<Record<SoundBus, FakeGain>>;
  readonly duck: FakeGain;
}

export function mixerGraph(ctx: FakeContext): MixerGraph {
  const [master, music, voice, world, ambient, ui, duck] = ctx.gains;
  if (
    master === undefined ||
    music === undefined ||
    voice === undefined ||
    world === undefined ||
    ambient === undefined ||
    ui === undefined ||
    duck === undefined
  ) {
    throw new Error('the engine has not built its mixer yet');
  }
  return { master, buses: { music, voice, world, ambient, ui }, duck };
}
