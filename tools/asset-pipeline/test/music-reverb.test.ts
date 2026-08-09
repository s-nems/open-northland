import { describe, expect, it } from 'vitest';
import { applyWavesReverb } from '../src/stages/music/reverb.js';

const RATE = 22050;

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
