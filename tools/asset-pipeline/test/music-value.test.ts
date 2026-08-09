import { describe, expect, it } from 'vitest';
import { curveValue, DEFAULT_PERFORMANCE_CHORD, musicValueToMidi } from '../src/stages/music/music-value.js';

/**
 * Resolver cases hand-walked from the documented algorithm over the default performance chord
 * (root C, 0x91 triad, major scale). Mode 14 = chord root + scale + chord intervals; mode 16
 * inherits the part mode.
 */
describe('musicValueToMidi', () => {
  const resolve = (musicValue: number, noteMode = 16, partMode = 14): number | undefined =>
    musicValueToMidi(DEFAULT_PERFORMANCE_CHORD, undefined, musicValue, noteMode, partMode);

  it('walks the chord tones of the default triad', () => {
    expect(resolve(0x3000)).toBe(36);
    expect(resolve(0x3100)).toBe(40);
    expect(resolve(0x3200)).toBe(43);
  });

  it('walks the scale from the chord tone', () => {
    expect(resolve(0x3010)).toBe(38);
  });

  it('gives back the octaves borrowed by a negative octave nibble', () => {
    expect(resolve(0xe000)).toBe(0);
  });

  it('resolves fixed play mode to the raw MIDI key', () => {
    expect(resolve(0x1234, 0)).toBe(0x34);
  });

  it('inherits the part play mode only when the note mode is NONE', () => {
    expect(resolve(0x3000, 14, 1)).toBe(36);
  });

  it('drops notes whose effective mode is key-root', () => {
    expect(resolve(0x3000, 16, 1)).toBeUndefined();
  });
});

describe('curveValue', () => {
  const INSTANT = 1;
  const SINE = 4;

  it('jumps to the end value on instant curves regardless of phase', () => {
    expect(curveValue(INSTANT, 0, 20, 120)).toBe(120);
    expect(curveValue(INSTANT, 0.99, 20, 120)).toBe(120);
  });

  it('starts a sine curve at the start value', () => {
    expect(curveValue(SINE, 0, 8192, 16383)).toBe(8192);
  });

  it('interpolates linearly by default', () => {
    expect(curveValue(0, 0.5, 0, 1)).toBeCloseTo(0.5, 6);
  });
});
