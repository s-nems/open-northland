import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_INPUT_DELAY_TICKS, InputDelayEstimator } from '../src/index.js';

/** The delay a player feels must hold still: a spike raises it at once, a calm trip lowers it slowly. */

/** Samples in a row a lower trip has to persist for before the delay steps down. */
const QUIET_SAMPLES_TO_LOWER = 10;

describe('input delay estimator', () => {
  it('budgets ceil((rtt + jitter) / tick) + 1 ticks', () => {
    const delay = new InputDelayEstimator();
    expect(delay.ticks).toBe(INITIAL_INPUT_DELAY_TICKS);
    expect(delay.sample(TICK_MS * 1.2)).toBe(true);
    expect(delay.ticks).toBe(3);
  });

  it('raises on the spot when a spike arrives, jitter included', () => {
    const delay = new InputDelayEstimator();
    delay.sample(0);
    const spike = TICK_MS * 3.5;
    expect(delay.sample(spike)).toBe(true);
    expect(delay.ticks).toBe(Math.ceil((spike + delay.jitterMs) / TICK_MS) + 1);
  });

  it('lowers one tick at a time, each step only after a quiet run of samples', () => {
    const delay = new InputDelayEstimator();
    delay.sample(TICK_MS * 4);
    expect(delay.ticks).toBe(5);
    let quiet = 0;
    while (delay.ticks === 5) {
      expect(quiet).toBeLessThan(QUIET_SAMPLES_TO_LOWER * 10);
      delay.sample(0);
      quiet++;
    }
    expect(delay.ticks).toBe(4);
    expect(quiet).toBeGreaterThanOrEqual(QUIET_SAMPLES_TO_LOWER);
    for (let i = 1; i < QUIET_SAMPLES_TO_LOWER; i++) expect(delay.sample(0)).toBe(false);
    expect(delay.sample(0)).toBe(true);
    expect(delay.ticks).toBe(3);
  });

  it('never drops below one tick, where an instant trip lands', () => {
    const delay = new InputDelayEstimator();
    for (let i = 0; i < QUIET_SAMPLES_TO_LOWER * 4; i++) delay.sample(0);
    expect(delay.ticks).toBe(1);
  });
});
