import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUMES,
  notificationShot,
  type OneShot,
  oneShotBus,
  SOUND_BUSES,
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
    expect(VOLUME_RANGE_DB).toBe(40);
    expect(dB(volumeGain(50))).toBeCloseTo(-VOLUME_RANGE_DB / 2, 6);
    expect(dB(volumeGain(80))).toBeCloseTo(-8, 6);
    expect(dB(volumeGain(1))).toBeCloseTo(-39.6, 6);
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

  it('puts action sounds and unprompted voices (chatter, screams, animal calls) on world', () => {
    expect(oneShotBus(shot({ kind: 'sfx' }))).toBe('world');
    expect(oneShotBus(shot({ kind: 'voice' }))).toBe('world');
    expect(oneShotBus(shot({ kind: 'voice', scream: true }))).toBe('world');
  });

  it('puts jingles, alerts, GUI cues and notifications on ui', () => {
    expect(oneShotBus(shot({ kind: 'jingle', musicType: 0 }))).toBe('ui');
    expect(oneShotBus(shot({ kind: 'alert', alert: 'baseAttacked' }))).toBe('ui');
    expect(oneShotBus(shot(undefined))).toBe('ui');
    expect(oneShotBus(uiCueShot('confirm'))).toBe('ui');
    expect(oneShotBus(notificationShot('card', '1'))).toBe('ui');
  });

  it('puts a shot that names its bus there: an answer on responses', () => {
    expect(oneShotBus({ ...shot(undefined), bus: 'responses' })).toBe('responses');
  });

  it('lists the buses players read: music, responses, world, ambience, interface', () => {
    expect(SOUND_BUSES).toEqual(['music', 'responses', 'world', 'ambient', 'ui']);
  });
});
