import { decodeWav } from '@open-northland/formats/wav';
import { VOICE_MUSIC_DUCK_DB } from '../../data/mixer.js';
import type { BusDuck } from './bus-duck.js';
import { CLICK_FREE_RAMP_S, rampParam } from './ramps.js';

interface Speaking {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

/**
 * The one narration line at a time: a briefing page's spoken text. A new line cuts the one still
 * speaking, a stop fades it out click-free, and the music dips under it by the voice duck for its
 * length. Unrationed by the arbiter: the player's page turn starts and stops it, never the world.
 * The wav decodes here rather than in the browser, which does not read every codec a map ships
 * (IMA ADPCM); one that does not decode stays silent.
 */
export class Narration {
  private speaking: Speaking | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly musicDuck: BusDuck | null,
  ) {}

  play(wav: Uint8Array): void {
    this.stop();
    let clip: ReturnType<typeof decodeWav>;
    try {
      clip = decodeWav(wav);
    } catch {
      return;
    }
    const frames = clip.channels[0]?.length ?? 0;
    if (frames === 0) return;
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(clip.channels.length, frames, clip.sampleRate);
    clip.channels.forEach((samples, channel) => {
      buffer.getChannelData(channel).set(samples.subarray(0, frames));
    });
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain).connect(this.out);
    this.musicDuck?.hold(ctx, VOICE_MUSIC_DUCK_DB, buffer.duration);
    const speaking = { source, gain };
    this.speaking = speaking;
    source.onended = () => {
      if (this.speaking === speaking) this.speaking = null;
    };
    source.start(ctx.currentTime);
  }

  stop(): void {
    const speaking = this.speaking;
    this.speaking = null;
    if (speaking === null) return;
    rampParam(this.ctx, speaking.gain.gain, 0, CLICK_FREE_RAMP_S);
    speaking.source.stop(this.ctx.currentTime + CLICK_FREE_RAMP_S);
  }
}
