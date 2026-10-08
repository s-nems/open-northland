import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUMES,
  type OneShot,
  oneShotBus,
  uiCueShot,
  VOLUME_CHANNELS,
  VOLUME_MAX,
  VOLUME_RANGE_DB,
  volumeGain,
} from '../src/index.js';

const dB = (gain: number): number => 20 * Math.log10(gain);

describe('volumeGain', () => {
  it('is linear in dB over the slider range, full scale at the top', () => {
    expect(volumeGain(VOLUME_MAX)).toBe(1);
    expect(dB(volumeGain(50))).toBeCloseTo(-VOLUME_RANGE_DB / 2, 6);
    expect(dB(volumeGain(80))).toBeCloseTo(-10, 6);
    expect(dB(volumeGain(1))).toBeCloseTo(-49.5, 6);
    // Each step is the same number of dB anywhere on the slider.
    expect(dB(volumeGain(31)) - dB(volumeGain(30))).toBeCloseTo(dB(volumeGain(91)) - dB(volumeGain(90)), 6);
  });

  it('mutes fully at zero instead of stopping at the range floor', () => {
    expect(volumeGain(0)).toBe(0);
  });

  it('clamps positions outside the slider and silences a non-number', () => {
    expect(volumeGain(VOLUME_MAX + 40)).toBe(1);
    expect(volumeGain(-3)).toBe(0);
    expect(volumeGain(Number.NaN)).toBe(0);
  });
});

describe('mixer defaults', () => {
  it('has a slider position for every channel inside the range', () => {
    for (const channel of VOLUME_CHANNELS) {
      expect(DEFAULT_VOLUMES[channel]).toBeGreaterThan(0);
      expect(DEFAULT_VOLUMES[channel]).toBeLessThanOrEqual(VOLUME_MAX);
    }
  });
});

describe('oneShotBus', () => {
  const shot = (lane: OneShot['lane']): OneShot => ({
    files: ['a.wav'],
    gain: 1,
    pan: 0,
    key: 'k',
    ...(lane === undefined ? {} : { lane }),
  });

  it('puts action sounds on world and unprompted voices on voice', () => {
    expect(oneShotBus(shot({ kind: 'sfx' }))).toBe('world');
    expect(oneShotBus(shot({ kind: 'voice' }))).toBe('voice');
  });

  it('puts jingles and the shots that answer the player (GUI cues, order answers) on ui', () => {
    expect(oneShotBus(shot({ kind: 'jingle', musicType: 0 }))).toBe('ui');
    expect(oneShotBus(shot(undefined))).toBe('ui');
    expect(oneShotBus(uiCueShot('confirm'))).toBe('ui');
  });
});
