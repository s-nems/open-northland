import { decodeWav } from '@open-northland/formats/wav';
import { VOICE_MUSIC_DUCK_DB } from '../../data/mixer.js';
import type { BusDuck, DuckHold } from './bus-duck.js';
import { CLICK_FREE_RAMP_S, rampParam } from './ramps.js';

interface Speaking {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly duck: DuckHold | null;
}

/**
 * The one narration line at a time: a briefing page's spoken text. A new line cuts the one still
 * speaking, a stop fades it out click-free, and the music dips under it by the voice duck until it
 * ends or stops. Unrationed by the arbiter: the player's page turn starts and stops it, never the world.
 * The wav decodes here rather than in the browser, which does not read every codec a map ships
 * (IMA ADPCM); one that does not decode, or that the context cannot hold, stays silent.
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
    const ctx = this.ctx;
    const buffer = bufferOf(ctx, wav);
    if (buffer === null) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain).connect(this.out);
    const duck = this.musicDuck?.hold(ctx, VOICE_MUSIC_DUCK_DB, buffer.duration) ?? null;
    const speaking = { source, gain, duck };
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
    if (speaking.duck !== null) this.musicDuck?.release(this.ctx, speaking.duck);
    rampParam(this.ctx, speaking.gain.gain, 0, CLICK_FREE_RAMP_S);
    speaking.source.stop(this.ctx.currentTime + CLICK_FREE_RAMP_S);
  }
}

/** The clip as an audio buffer, or null when it does not decode or the context refuses its format. */
function bufferOf(ctx: BaseAudioContext, wav: Uint8Array): AudioBuffer | null {
  try {
    const clip = decodeWav(wav);
    const frames = clip.channels[0]?.length ?? 0;
    if (frames === 0) return null;
    const buffer = ctx.createBuffer(clip.channels.length, frames, clip.sampleRate);
    clip.channels.forEach((samples, channel) => {
      buffer.getChannelData(channel).set(samples.subarray(0, frames));
    });
    return buffer;
  } catch {
    return null;
  }
}
