import type { ShotLayer, SoundBus } from '../../src/index.js';
import type { FakeContext, FakeGain } from './fake-audio.js';

/** The engine's mixer nodes, by the order it creates its gains: the master, the buses in
 *  `SOUND_BUSES` order, the music duck, then the perspective layers (world detail and impact, the
 *  ambient bed). */
export interface MixerGraph {
  readonly master: FakeGain;
  readonly buses: Readonly<Record<SoundBus, FakeGain>>;
  readonly duck: FakeGain;
  readonly layers: {
    readonly world: Readonly<Record<ShotLayer, FakeGain>>;
    readonly bed: FakeGain;
  };
}

export function mixerGraph(ctx: FakeContext): MixerGraph {
  const [master, music, responses, world, ambient, ui, duck, worldDetail, worldImpact, bed] = ctx.gains;
  if (
    master === undefined ||
    music === undefined ||
    responses === undefined ||
    world === undefined ||
    ambient === undefined ||
    ui === undefined ||
    duck === undefined ||
    worldDetail === undefined ||
    worldImpact === undefined ||
    bed === undefined
  ) {
    throw new Error('the engine has not built its mixer yet');
  }
  return {
    master,
    buses: { music, responses, world, ambient, ui },
    duck,
    layers: { world: { detail: worldDetail, impact: worldImpact }, bed },
  };
}
