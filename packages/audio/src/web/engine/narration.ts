import { decodeWav } from '@open-northland/formats/wav';
import { VOICE_MUSIC_DUCK_DB } from '../../data/mixer.js';
import type { BusDuck, DuckHold } from './bus-duck.js';
import { CLICK_FREE_RAMP_S, rampParam } from './ramps.js';

interface Speaking {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly duck: DuckHold | null;
  /** Context time the source started, at the line's `offsetS`. */
  readonly startedAt: number;
}

/** Where the narration line stands: `waiting` is a line asked to play before audio started. */
export type NarrationStatus = 'idle' | 'waiting' | 'playing' | 'paused' | 'ended';

export interface NarrationState {
  readonly status: NarrationStatus;
  readonly positionS: number;
  /** 0 until the clip is decoded. */
  readonly durationS: number;
}

export const NARRATION_IDLE: NarrationState = { status: 'idle', positionS: 0, durationS: 0 };

/** Where a line starts: at `fromS` into the clip, and held paused there when `paused`. */
export interface NarrationCue {
  readonly fromS?: number;
  readonly paused?: boolean;
}

/** The clip being narrated: playing while it has a source, else held at `offsetS`. */
interface Line {
  readonly buffer: AudioBuffer;
  offsetS: number;
  speaking: Speaking | null;
  ended: boolean;
}

/**
 * The one narration line at a time: a briefing page's spoken text, with a transport the page's player
 * drives. A new line cuts the one still speaking, a stop or a pause fades it out click-free, and the
 * music dips under it by the voice duck while it speaks. Pause, resume and seek restart a buffer
 * source at the held offset. Unrationed by the arbiter: the player's page turn starts and stops it,
 * never the world. The wav decodes here rather than in the browser, which does not read every codec a
 * map ships (IMA ADPCM); one that does not decode, or that the context cannot hold, stays silent.
 */
export class Narration {
  private line: Line | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly musicDuck: BusDuck | null,
  ) {}

  play(wav: Uint8Array, { fromS = 0, paused = false }: NarrationCue = {}): void {
    this.stop();
    const buffer = bufferOf(this.ctx, wav);
    if (buffer === null) return;
    this.line = { buffer, offsetS: clampTo(fromS, buffer.duration), speaking: null, ended: false };
    if (!paused) this.resume();
  }

  /** Hold the line where it stands. */
  pause(): void {
    const line = this.line;
    if (line === null || line.speaking === null) return;
    line.offsetS = this.positionOf(line);
    this.halt(line);
  }

  /** Speak the held line on from where it stands; an ended line starts over. */
  resume(): void {
    const line = this.line;
    if (line === null || line.speaking !== null) return;
    if (line.ended || line.offsetS >= line.buffer.duration) line.offsetS = 0;
    line.ended = false;
    this.speak(line);
  }

  /** Move the line to `atS`, speaking on from there if it was speaking. */
  seek(atS: number): void {
    const line = this.line;
    if (line === null) return;
    const speaking = line.speaking !== null;
    if (speaking) this.halt(line);
    line.offsetS = clampTo(atS, line.buffer.duration);
    line.ended = false;
    if (speaking) this.speak(line);
  }

  stop(): void {
    const line = this.line;
    this.line = null;
    if (line !== null) this.halt(line);
  }

  state(): NarrationState {
    const line = this.line;
    if (line === null) return NARRATION_IDLE;
    const status = line.speaking !== null ? 'playing' : line.ended ? 'ended' : 'paused';
    return { status, positionS: this.positionOf(line), durationS: line.buffer.duration };
  }

  private positionOf(line: Line): number {
    const at =
      line.speaking === null ? line.offsetS : line.offsetS + this.ctx.currentTime - line.speaking.startedAt;
    return clampTo(at, line.buffer.duration);
  }

  private speak(line: Line): void {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = line.buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain).connect(this.out);
    const rest = line.buffer.duration - line.offsetS;
    const duck = this.musicDuck?.hold(ctx, VOICE_MUSIC_DUCK_DB, rest) ?? null;
    const speaking = { source, gain, duck, startedAt: ctx.currentTime };
    line.speaking = speaking;
    source.onended = () => {
      if (line.speaking !== speaking) return;
      line.speaking = null;
      line.offsetS = line.buffer.duration;
      line.ended = true;
    };
    source.start(ctx.currentTime, line.offsetS);
  }

  /** Silence the line's source; the line itself stays where it was put. */
  private halt(line: Line): void {
    const speaking = line.speaking;
    line.speaking = null;
    if (speaking === null) return;
    if (speaking.duck !== null) this.musicDuck?.release(this.ctx, speaking.duck);
    rampParam(this.ctx, speaking.gain.gain, 0, CLICK_FREE_RAMP_S);
    speaking.source.stop(this.ctx.currentTime + CLICK_FREE_RAMP_S);
  }
}

const clampTo = (atS: number, durationS: number): number => Math.min(durationS, Math.max(0, atS));

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
