import { describe, expect, it } from 'vitest';
import type { WeatherAmounts } from '../../src/data/weather/types.js';
import { atmosphereLook, MAX_HAZE_ALPHA } from '../../src/gpu/weather/atmosphere-look.js';

/** Readability budget: the heaviest weather keeps this share of the scene's light on average, and at its
 *  darkest point (a storm-cloud shadow in a vignette corner) this share. */
const MEAN_KEPT = 0.9;
const DARKEST_KEPT = 0.74;
const MAX_VIGNETTE = 0.12;
/** A full flash adds at most this much luminance: a soft lift, not a white wash. */
const MAX_FLASH_LUMINANCE = 0.06;

const luminance = (rgb: readonly [number, number, number]): number =>
  0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

const HEAVIEST: readonly WeatherAmounts[] = [
  { rain: 1, snow: 0, sand: 0 },
  { rain: 0, snow: 1, sand: 0 },
  { rain: 0, snow: 0, sand: 1 },
  { rain: 1, snow: 1, sand: 1 },
];

describe('atmosphere look', () => {
  it('stays an accent in the heaviest storm of any kind', () => {
    for (const amounts of HEAVIEST) {
      const look = atmosphereLook(amounts, 0);
      expect(look.hazeAlpha).toBeLessThanOrEqual(MAX_HAZE_ALPHA);
      expect(look.vignette).toBeLessThanOrEqual(MAX_VIGNETTE);
      expect(luminance(look.grade)).toBeGreaterThanOrEqual(MEAN_KEPT - 1e-9);
      expect(luminance(look.grade) * (1 - look.cloudShadow) * (1 - look.vignette)).toBeGreaterThan(
        DARKEST_KEPT,
      );
    }
  });

  it('lifts the sky softly on a flash and draws nothing when clear', () => {
    const storm = atmosphereLook({ rain: 1, snow: 0, sand: 0 }, 1);
    expect(luminance(storm.flash)).toBeLessThan(MAX_FLASH_LUMINANCE);
    expect(luminance(storm.grade)).toBeGreaterThan(
      luminance(atmosphereLook({ rain: 1, snow: 0, sand: 0 }, 0).grade),
    );
    expect(atmosphereLook({ rain: 0, snow: 0, sand: 0 }, 0).visible).toBe(false);
  });
});
