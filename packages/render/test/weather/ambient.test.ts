import { describe, expect, it } from 'vitest';
import {
  AMBIENT_FULL_AMOUNT,
  AMBIENT_NO_WEATHER,
  ambientStrength,
  buildAmbientField,
} from '../../src/data/weather/ambient.js';
import { weatherAmountAt } from '../../src/data/weather/field.js';
import { WEATHER_STORM_RANGE } from '../../src/data/weather/precipitation.js';
import { WEATHER_KINDS } from '../../src/data/weather/types.js';

const HOUR = 3600;
const SESSION_SECONDS = 6 * HOUR;
const STEP_SECONDS = 5;

function wetShare(seed: number): number {
  let wet = 0;
  let steps = 0;
  for (let t = 0; t < SESSION_SECONDS; t += STEP_SECONDS) {
    if (ambientStrength(seed, t) > 0) wet++;
    steps++;
  }
  return wet / steps;
}

describe('ambientStrength', () => {
  it('stays clear through the opening of every game', () => {
    const OPENING_SECONDS = 25 * 60;
    for (let seed = 0; seed < 200; seed++) {
      for (let t = 0; t < OPENING_SECONDS; t += 30) expect(ambientStrength(seed, t)).toBe(0);
    }
  });

  it('keeps weather rare across a long session', () => {
    let total = 0;
    const SEEDS = 100;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const share = wetShare(seed);
      expect(share).toBeLessThan(0.2);
      total += share;
    }
    const mean = total / SEEDS;
    expect(mean).toBeGreaterThan(0.02);
    expect(mean).toBeLessThan(0.1);
  });

  it('draws another schedule for another seed and repeats for the same one', () => {
    const firstWet = (seed: number): number => {
      for (let t = 0; t < 4 * SESSION_SECONDS; t += STEP_SECONDS) if (ambientStrength(seed, t) > 0) return t;
      return -1;
    };
    const starts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(firstWet));
    expect(starts.size).toBeGreaterThan(6);
    expect(firstWet(3)).toBe(firstWet(3));
  });

  it('fades in without a jump', () => {
    let previous = 0;
    for (let t = 0; t < SESSION_SECONDS; t += 1) {
      const now = ambientStrength(11, t);
      expect(Math.abs(now - previous)).toBeLessThan(0.03);
      previous = now;
    }
  });
});

describe('ambient amounts', () => {
  it('never reach a storm', () => {
    for (const kind of WEATHER_KINDS) {
      expect(AMBIENT_FULL_AMOUNT[kind]).toBeLessThan(WEATHER_STORM_RANGE[kind].start);
    }
  });
});

describe('buildAmbientField', () => {
  const sectors = {
    sectorsX: 2,
    sectorsY: 1,
    kinds: Uint8Array.from([WEATHER_KINDS.indexOf('snow'), AMBIENT_NO_WEATHER]),
  };

  it('lays each sector its own kind', () => {
    const field = buildAmbientField(sectors, 0.5);
    expect(field.any).toBe(true);
    expect(weatherAmountAt(field, 'snow', 5, 5)).toBeCloseTo(AMBIENT_FULL_AMOUNT.snow / 2);
    expect(weatherAmountAt(field, 'rain', 5, 5)).toBe(0);
    expect(weatherAmountAt(field, 'snow', 15, 5)).toBe(0);
  });

  it('is dry at no strength', () => {
    expect(buildAmbientField(sectors, 0).any).toBe(false);
  });
});
