import { describe, expect, it } from 'vitest';
import { applyWavesReverb } from '../src/stages/music/reverb.js';

/** The rate the stage publishes at: the damping coefficient does not scale, so a different rate here
 *  would measure a filter that never ships. */
const RATE = 44100;

function impulseChannels(seconds: number): Float32Array[] {
  const frames = Math.round(seconds * RATE);
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  for (const channel of channels) channel[0] = 1;
  return channels;
}

function energy(channel: Float32Array, fromS: number, toS: number): number {
  let sum = 0;
  for (let i = Math.round(fromS * RATE); i < Math.min(Math.round(toS * RATE), channel.length); i++) {
    const v = channel[i] ?? 0;
    sum += v * v;
  }
  return sum;
}

const PARAMS = { inGainDb: 0, reverbMixDb: -4.8, reverbTimeMs: 2000 };

/** The rate the music stage publishes at, which sets the comb tunings the damping filter sees. */
const PUBLISH_RATE = 44100;
const OCTAVE_LOWS = [250, 500, 1000, 2000, 4000, 8000] as const;
const TONES_PER_OCTAVE = 8;
const EXCITATION_S = 2;
/** Widest spread of added level across the octaves before the wet path counts as tilting. */
const TILT_LIMIT_DB = 2;

/** One octave of the spectrum, gated into notes: sustained tones would only excite the tail. */
function octaveNotes(lo: number): Float32Array[] {
  const frames = Math.round(EXCITATION_S * PUBLISH_RATE);
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  for (let tone = 0; tone < TONES_PER_OCTAVE; tone++) {
    const freq = lo * 2 ** (tone / TONES_PER_OCTAVE);
    for (let i = 0; i < frames; i++) {
      const value = Math.sin((2 * Math.PI * freq * i) / PUBLISH_RATE) / TONES_PER_OCTAVE;
      for (const channel of channels) channel[i] = (channel[i] ?? 0) + value;
    }
  }
  const period = Math.round(PUBLISH_RATE * 0.25);
  const held = Math.round(PUBLISH_RATE * 0.1);
  for (const channel of channels) {
    for (let i = 0; i < frames; i++) if (i % period >= held) channel[i] = 0;
  }
  return channels;
}

function totalEnergy(channels: readonly Float32Array[]): number {
  let sum = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) sum += (channel[i] ?? 0) ** 2;
  }
  return sum;
}

describe('applyWavesReverb', () => {
  it('adds a decaying tail scaled by the authored mix', () => {
    const channels = impulseChannels(3);
    applyWavesReverb(channels, RATE, PARAMS);
    const early = energy(channels[0] ?? new Float32Array(), 0.1, 0.6);
    const late = energy(channels[0] ?? new Float32Array(), 2.2, 2.7);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(0);
    // The tail decays towards -60 dB at reverbTimeMs: late must sit well below early.
    expect(late).toBeLessThan(early / 100);

    const quieter = impulseChannels(3);
    applyWavesReverb(quieter, RATE, { ...PARAMS, reverbMixDb: -24.8 });
    const quietEarly = energy(quieter[0] ?? new Float32Array(), 0.1, 0.6);
    // 20 dB less mix is a factor 100 in energy.
    expect((quietEarly * 100) / early).toBeCloseTo(1, 2);
  });

  it('stretches the tail with the authored reverb time', () => {
    const shorter = impulseChannels(2);
    applyWavesReverb(shorter, RATE, { ...PARAMS, reverbTimeMs: 1000 });
    const longer = impulseChannels(2);
    applyWavesReverb(longer, RATE, { ...PARAMS, reverbTimeMs: 2000 });
    const late = (channels: Float32Array[]): number => energy(channels[0] ?? new Float32Array(), 0.8, 1.2);
    expect(late(longer)).toBeGreaterThan(late(shorter) * 10);
  });

  it('adds the same level to every octave, so the wet path does not tilt the balance', () => {
    const gainsDb = OCTAVE_LOWS.map((lo) => {
      const dry = octaveNotes(lo);
      const wet = octaveNotes(lo);
      applyWavesReverb(wet, PUBLISH_RATE, PARAMS);
      return 10 * Math.log10(totalEnergy(wet) / totalEnergy(dry));
    });
    for (const gainDb of gainsDb) expect(gainDb).toBeGreaterThan(0);
    expect(Math.max(...gainsDb) - Math.min(...gainsDb)).toBeLessThan(TILT_LIMIT_DB);
  });

  it('keeps the dry signal in place', () => {
    const channels = impulseChannels(1);
    applyWavesReverb(channels, RATE, PARAMS);
    expect(channels[0]?.[0]).toBeCloseTo(1, 3);
  });

  it('decorrelates the two channels', () => {
    const channels = impulseChannels(2);
    applyWavesReverb(channels, RATE, PARAMS);
    const left = channels[0] ?? new Float32Array();
    const right = channels[1] ?? new Float32Array();
    let diff = 0;
    for (let i = 1; i < left.length; i++) diff += Math.abs((left[i] ?? 0) - (right[i] ?? 0));
    expect(diff).toBeGreaterThan(0);
  });
});
