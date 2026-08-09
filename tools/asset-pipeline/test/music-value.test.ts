import { describe, expect, it } from 'vitest';
import {
  curveValue,
  DEFAULT_PERFORMANCE_CHORD,
  DMUS_PLAYMODE_CHORD_INTERVALS,
  DMUS_PLAYMODE_CHORD_ROOT,
  DMUS_PLAYMODE_FIXED,
  DMUS_PLAYMODE_KEY_ROOT,
  DMUS_PLAYMODE_NONE,
  DMUS_PLAYMODE_SCALE_INTERVALS,
  musicValueToMidi,
} from '../src/stages/music/music-value.js';

/** The part play mode the corpus authors: chord-root walks over chord and scale intervals. */
const CHORD_SCALE_MODE =
  DMUS_PLAYMODE_CHORD_ROOT | DMUS_PLAYMODE_SCALE_INTERVALS | DMUS_PLAYMODE_CHORD_INTERVALS;

/**
 * Resolver cases hand-walked from the documented algorithm over the default performance chord
 * (root C, 0x91 triad, major scale).
 */
describe('musicValueToMidi', () => {
  const resolve = (
    musicValue: number,
    noteMode = DMUS_PLAYMODE_NONE,
    partMode = CHORD_SCALE_MODE,
  ): number | undefined =>
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
    expect(resolve(0x1234, DMUS_PLAYMODE_FIXED)).toBe(0x34);
  });

  it('inherits the part play mode only when the note mode is NONE', () => {
    expect(resolve(0x3000, CHORD_SCALE_MODE, DMUS_PLAYMODE_KEY_ROOT)).toBe(36);
  });

  it('drops notes whose effective mode is key-root', () => {
    expect(resolve(0x3000, DMUS_PLAYMODE_NONE, DMUS_PLAYMODE_KEY_ROOT)).toBeUndefined();
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
