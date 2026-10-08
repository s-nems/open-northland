import { describe, expect, it } from 'vitest';
import {
  integratedLoudness,
  kWeighting,
  levellingGainDb,
  MUSIC_BOOST_PEAK_CEILING_DBFS,
  MUSIC_LOUDNESS_TARGET_LUFS,
  samplePeakDb,
} from '../src/stages/music/loudness.js';

/** Loudness measurement against the published BS.1770-4 coefficient table and the EBU Tech 3341
 *  reference signals, and the gain rule built on it. */

const RATE = 48000;
const TONE_HZ = 1000;

/** A stereo sine at `dbfs` peak level for each `[dbfs, seconds]` section, both channels equal. */
function stereoTone(sections: readonly (readonly [number, number])[]): Float32Array[] {
  const frames = sections.reduce((sum, [, seconds]) => sum + seconds * RATE, 0);
  const channel = new Float32Array(frames);
  let at = 0;
  for (const [dbfs, seconds] of sections) {
    const amplitude = 10 ** (dbfs / 20);
    for (let i = 0; i < seconds * RATE; i++, at++) {
      channel[at] = amplitude * Math.sin((2 * Math.PI * TONE_HZ * at) / RATE);
    }
  }
  return [channel, channel.slice()];
}

describe('K-weighting', () => {
  it('derives the standard’s 48 kHz coefficients', () => {
    const [shelf, highpass] = kWeighting(RATE);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 9);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 9);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 9);
    expect([highpass.b0, highpass.b1, highpass.b2]).toEqual([1, -2, 1]);
    expect(highpass.a1).toBeCloseTo(-1.99004745483398, 9);
    expect(highpass.a2).toBeCloseTo(0.99007225036621, 9);
  });
});

describe('integrated loudness', () => {
  it('reads a -23 dBFS stereo 1 kHz tone as -23 LUFS', () => {
    const tone = stereoTone([[-23, 20]]);
    expect(integratedLoudness(tone, RATE * 20, RATE)).toBeCloseTo(-23, 1);
  });

  it('gates quiet passages out relative to the loud body', () => {
    const tone = stereoTone([
      [-36, 10],
      [-23, 60],
      [-36, 10],
    ]);
    expect(integratedLoudness(tone, RATE * 80, RATE)).toBeCloseTo(-23, 1);
  });

  it('reads silence as unmeasurable', () => {
    const silence = [new Float32Array(RATE), new Float32Array(RATE)];
    expect(integratedLoudness(silence, RATE, RATE)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('measures only the frames it is given', () => {
    const tone = stereoTone([
      [-23, 20],
      [-10, 20],
    ]);
    expect(integratedLoudness(tone, RATE * 20, RATE)).toBeCloseTo(-23, 1);
  });
});

describe('levelling gain', () => {
  it('cuts a loud track all the way to the target', () => {
    expect(levellingGainDb(MUSIC_LOUDNESS_TARGET_LUFS + 5, 0)).toBeCloseTo(-5, 9);
  });

  it('boosts a quiet track only as far as its peak allows', () => {
    const quiet = MUSIC_LOUDNESS_TARGET_LUFS - 8;
    expect(levellingGainDb(quiet, MUSIC_BOOST_PEAK_CEILING_DBFS - 12)).toBeCloseTo(8, 9);
    expect(levellingGainDb(quiet, MUSIC_BOOST_PEAK_CEILING_DBFS - 3)).toBeCloseTo(3, 9);
    expect(levellingGainDb(quiet, MUSIC_BOOST_PEAK_CEILING_DBFS + 1)).toBe(0);
  });

  it('leaves an unmeasurable track at its level', () => {
    expect(levellingGainDb(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('reads the sample peak in dBFS', () => {
    const tone = stereoTone([[-6, 1]]);
    expect(samplePeakDb(tone, RATE)).toBeCloseTo(-6, 2);
  });
});
