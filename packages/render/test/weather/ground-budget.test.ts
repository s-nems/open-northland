import { describe, expect, it } from 'vitest';
import { buildWeatherField } from '../../src/data/weather/field.js';
import type { WeatherConditions } from '../../src/data/weather/types.js';
import {
  groundBudget,
  RIPPLE_SLOTS,
  SPLASH_SLOTS,
  WISP_SLOTS,
  weatherActivity,
} from '../../src/gpu/weather/ground-budget.js';

const CALM = { storm: 0, windX: 0, windY: 0, gust: 0 };

function conditions(rain: number, snow: number, sand: number): WeatherConditions {
  return { amounts: { rain, snow, sand }, ...CALM, flash: 0, strikes: [] };
}

describe('ground reaction budget', () => {
  it('runs nothing on a clear screen', () => {
    expect(groundBudget(1920, 1080, { rain: 0, snow: 0, sand: 0 }, CALM)).toEqual({
      splashes: 0,
      ripples: 0,
      wisps: 0,
    });
  });

  it('follows the viewed ground area, not the map, and never passes its slot ranges', () => {
    const rain = { rain: 1, snow: 1, sand: 0 };
    const small = groundBudget(640, 360, rain, CALM);
    const large = groundBudget(1280, 720, rain, CALM);
    expect(large.splashes).toBeCloseTo(small.splashes * 4, -1);
    const huge = groundBudget(7680, 4320, rain, { storm: 1, windX: 200, windY: 0, gust: 1 });
    expect(huge).toEqual({ splashes: SPLASH_SLOTS, ripples: RIPPLE_SLOTS, wisps: WISP_SLOTS });
  });

  it('raises the count in a storm and the wisps in wind', () => {
    const activity = { rain: 1, snow: 1, sand: 0 };
    const calm = groundBudget(1280, 720, activity, CALM);
    const storm = groundBudget(1280, 720, activity, { ...CALM, storm: 1 });
    const windy = groundBudget(1280, 720, activity, { ...CALM, windX: 80 });
    expect(storm.splashes).toBeGreaterThan(calm.splashes);
    expect(windy.wisps).toBeGreaterThan(calm.wisps);
  });

  it('reads activity as the screen amount over the field under the screen centre', () => {
    const field = buildWeatherField(
      [{ weather: 'rain', min: { hx: 0, hy: 0 }, max: { hx: 99, hy: 99 }, density: 2000 }],
      100,
      100,
    );
    expect(weatherActivity(conditions(0.2, 0, 0), field, 50, 50).rain).toBeCloseTo(1, 5);
    expect(weatherActivity(conditions(0.1, 0, 0), field, 50, 50).rain).toBeCloseTo(0.5, 5);
    expect(weatherActivity(conditions(0, 0, 0), field, 50, 50).rain).toBe(0);
    // A sky raining over a dry centre (the view straddles an edge) still counts as raining.
    expect(weatherActivity(conditions(0, 0.1, 0), field, 50, 50).snow).toBe(1);
  });
});
