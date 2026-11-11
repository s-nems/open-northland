import { describe, expect, it } from 'vitest';
import {
  DETAIL_HYSTERESIS,
  type DetailTier,
  detailTierAt,
  MINIMAL_DETAIL_BELOW,
  REDUCED_DETAIL_BELOW,
  SPARSE_DETAIL_BELOW,
  VIEW_DETAILS,
  type ViewDetail,
  WAVE_STEP_TICKS,
  waveStepOf,
} from '../../src/data/view-detail.js';

const TIERS: readonly DetailTier[] = ['full', 'reduced', 'sparse', 'minimal'];
const JUST = 0.001;

describe('detailTierAt', () => {
  it('draws everything at the game zoom and above', () => {
    expect(detailTierAt(1, 'automatic')).toBe('full');
    expect(detailTierAt(REDUCED_DETAIL_BELOW, 'automatic')).toBe('full');
    expect(detailTierAt(2, 'automatic', 'minimal')).toBe('full');
  });

  it('steps down a tier below each threshold', () => {
    expect(detailTierAt(REDUCED_DETAIL_BELOW - JUST, 'automatic')).toBe('reduced');
    expect(detailTierAt(SPARSE_DETAIL_BELOW - JUST, 'automatic')).toBe('sparse');
    expect(detailTierAt(MINIMAL_DETAIL_BELOW - JUST, 'automatic')).toBe('minimal');
  });

  it('keeps full detail at every scale when the player asks for it', () => {
    expect(detailTierAt(MINIMAL_DETAIL_BELOW - JUST, 'full', 'minimal')).toBe('full');
  });

  it('takes a richer tier back only past the threshold by the margin', () => {
    const resting = SPARSE_DETAIL_BELOW + DETAIL_HYSTERESIS / 2;
    expect(detailTierAt(resting, 'automatic', 'sparse')).toBe('sparse');
    expect(detailTierAt(resting, 'automatic', 'reduced')).toBe('reduced');
    expect(detailTierAt(SPARSE_DETAIL_BELOW + DETAIL_HYSTERESIS + JUST, 'automatic', 'sparse')).toBe(
      'reduced',
    );
  });

  it('rises through several tiers at once, each by its own margin', () => {
    expect(detailTierAt(REDUCED_DETAIL_BELOW + DETAIL_HYSTERESIS / 2, 'automatic', 'minimal')).toBe(
      'reduced',
    );
  });
});

describe('VIEW_DETAILS', () => {
  it('only ever drops more from one tier to the next', () => {
    const drawn = (detail: ViewDetail): string[] =>
      Object.entries(detail)
        .filter(([, value]) => value === true)
        .map(([key]) => key);
    for (let i = 1; i < TIERS.length; i++) {
      const richer = drawn(VIEW_DETAILS[TIERS[i - 1] ?? 'full']);
      const sparser = drawn(VIEW_DETAILS[TIERS[i] ?? 'full']);
      expect(richer).toEqual(expect.arrayContaining(sparser));
      expect(sparser.length).toBeLessThan(richer.length);
    }
  });
});

describe('waveStepOf', () => {
  it('holds a shore-wave frame for several ticks once a tier stills the environment', () => {
    const step = 3 * WAVE_STEP_TICKS + 1;
    expect(waveStepOf(step, VIEW_DETAILS.full)).toBe(step);
    expect(waveStepOf(step, VIEW_DETAILS.reduced)).toBe(3 * WAVE_STEP_TICKS);
  });
});
