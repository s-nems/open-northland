import { describe, expect, it } from 'vitest';
import {
  AMBIENT_HEAVY_LEVEL,
  AMBIENT_LEVEL_AMOUNTS,
  AMBIENT_LIGHT_LEVEL,
  AMBIENT_NO_WEATHER,
  AMBIENT_STORM_LEVEL,
  ambientAmount,
  buildAmbientField,
  variableWeather,
  WINTER_LYING_SNOW,
  winterWeather,
} from '../../src/data/weather/ambient.js';
import { WeatherCover } from '../../src/data/weather/cover.js';
import { buildWeatherField, weatherAmountAt } from '../../src/data/weather/field.js';
import { WEATHER_STORM_RANGE } from '../../src/data/weather/precipitation.js';
import { WEATHER_DENSITY_FULL, WEATHER_KINDS } from '../../src/data/weather/types.js';

const HOUR = 3600;
const SESSION_SECONDS = 6 * HOUR;
const STEP_SECONDS = 5;
const SEEDS = 100;

/** Shares of a session's time spent under any weather and above the light level. */
function shares(weather: typeof variableWeather, seed: number): { wet: number; heavy: number } {
  let wet = 0;
  let heavy = 0;
  let steps = 0;
  for (let t = 0; t < SESSION_SECONDS; t += STEP_SECONDS) {
    const { level } = weather(seed, t);
    if (level > 0) wet++;
    if (level > AMBIENT_LIGHT_LEVEL) heavy++;
    steps++;
  }
  return { wet: wet / steps, heavy: heavy / steps };
}

describe('ambientAmount', () => {
  it('passes through each level amount and stays light under the storm threshold', () => {
    for (const kind of WEATHER_KINDS) {
      const [light, heavy, storm] = AMBIENT_LEVEL_AMOUNTS[kind];
      expect(ambientAmount(kind, 0)).toBe(0);
      expect(ambientAmount(kind, AMBIENT_LIGHT_LEVEL)).toBeCloseTo(light);
      expect(ambientAmount(kind, AMBIENT_HEAVY_LEVEL)).toBeCloseTo(heavy);
      expect(ambientAmount(kind, AMBIENT_STORM_LEVEL)).toBeCloseTo(storm);
      expect(ambientAmount(kind, AMBIENT_LIGHT_LEVEL / 2)).toBeCloseTo(light / 2);
      expect(light).toBeLessThan(WEATHER_STORM_RANGE[kind].start);
      expect(storm).toBeGreaterThan(WEATHER_STORM_RANGE[kind].start);
    }
  });
});

describe('variableWeather', () => {
  it('stays clear through the opening of every game', () => {
    const OPENING_SECONDS = 25 * 60;
    for (let seed = 0; seed < 200; seed++) {
      for (let t = 0; t < OPENING_SECONDS; t += 30) expect(variableWeather(seed, t).level).toBe(0);
    }
  });

  it('keeps weather rare and heavy weather rarer across a long session', () => {
    let wet = 0;
    let heavy = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const share = shares(variableWeather, seed);
      expect(share.wet).toBeLessThan(0.2);
      wet += share.wet;
      heavy += share.heavy;
    }
    expect(wet / SEEDS).toBeGreaterThan(0.02);
    expect(wet / SEEDS).toBeLessThan(0.1);
    expect(heavy / SEEDS).toBeGreaterThan(0);
    expect(heavy / SEEDS).toBeLessThan(wet / SEEDS / 3);
  });

  it('draws another schedule for another seed and repeats for the same one', () => {
    const firstWet = (seed: number): number => {
      for (let t = 0; t < 4 * SESSION_SECONDS; t += STEP_SECONDS) {
        if (variableWeather(seed, t).level > 0) return t;
      }
      return -1;
    };
    const starts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(firstWet));
    expect(starts.size).toBeGreaterThan(6);
    expect(firstWet(3)).toBe(firstWet(3));
  });

  it('fades without a jump', () => {
    for (const seed of [11, 12, 13, 14]) {
      let previous = 0;
      for (let t = 0; t < 2 * SESSION_SECONDS; t += 1) {
        const now = variableWeather(seed, t).level;
        expect(Math.abs(now - previous)).toBeLessThan(0.08);
        previous = now;
      }
    }
  });
});

describe('winterWeather', () => {
  it('snows most of the time, mostly lightly, with short breaks', () => {
    let wet = 0;
    let heavy = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const share = shares(winterWeather, seed);
      wet += share.wet;
      heavy += share.heavy;
    }
    expect(wet / SEEDS).toBeGreaterThan(0.8);
    expect(heavy / SEEDS).toBeLessThan(0.35);
    expect(heavy / SEEDS).toBeGreaterThan(0.05);
  });
});

describe('buildAmbientField', () => {
  const SNOW = WEATHER_KINDS.indexOf('snow');
  const RAIN = WEATHER_KINDS.indexOf('rain');
  const sectors = { sectorsX: 3, sectorsY: 1, kinds: Uint8Array.from([SNOW, AMBIENT_NO_WEATHER, RAIN]) };
  const light = { level: AMBIENT_LIGHT_LEVEL, cold: false };
  const [lightSnow] = AMBIENT_LEVEL_AMOUNTS.snow;
  const [lightRain] = AMBIENT_LEVEL_AMOUNTS.rain;

  it('lays each sector its own kind', () => {
    const field = buildAmbientField(sectors, { level: AMBIENT_LIGHT_LEVEL / 2, cold: false });
    expect(field.any).toBe(true);
    expect(weatherAmountAt(field, 'snow', 5, 5)).toBeCloseTo(lightSnow / 2);
    expect(weatherAmountAt(field, 'rain', 5, 5)).toBe(0);
    expect(weatherAmountAt(field, 'snow', 15, 5)).toBe(0);
    expect(weatherAmountAt(field, 'rain', 25, 5)).toBeCloseTo(lightRain / 2);
  });

  it('is dry at no level', () => {
    expect(buildAmbientField(sectors, { level: 0, cold: false }).any).toBe(false);
  });

  it('turns rain to snow when cold', () => {
    const field = buildAmbientField(sectors, { ...light, cold: true });
    expect(weatherAmountAt(field, 'rain', 25, 5)).toBe(0);
    expect(weatherAmountAt(field, 'snow', 25, 5)).toBeCloseTo(lightSnow);
  });

  it('leaves a sector the map wrote as the map wrote it', () => {
    const authored = buildWeatherField(
      [{ weather: 'rain', min: { hx: 0, hy: 0 }, max: { hx: 9, hy: 9 }, density: 3000 }],
      30,
      10,
    );
    const field = buildAmbientField(sectors, light, false, authored);
    expect(weatherAmountAt(field, 'rain', 5, 5)).toBeCloseTo(0.3);
    expect(weatherAmountAt(field, 'snow', 5, 5)).toBe(0);
    expect(weatherAmountAt(field, 'rain', 25, 5)).toBeCloseTo(lightRain);
  });

  it('falls over a trace the map wrote', () => {
    const TRACE_DENSITY = 35;
    const authored = buildWeatherField(
      [{ weather: 'snow', min: { hx: 0, hy: 0 }, max: { hx: 29, hy: 9 }, density: TRACE_DENSITY }],
      30,
      10,
    );
    const field = buildAmbientField(sectors, light, false, authored);
    expect(weatherAmountAt(field, 'rain', 25, 5)).toBeCloseTo(lightRain);
    expect(weatherAmountAt(field, 'snow', 25, 5)).toBeCloseTo(TRACE_DENSITY / WEATHER_DENSITY_FULL);
    const clear = buildAmbientField(sectors, { level: 0, cold: false }, false, authored);
    expect(clear.any).toBe(true);
  });

  it('snows everywhere in winter and keeps the ground white under a clear sky', () => {
    const snowing = buildAmbientField(sectors, light, true);
    expect(weatherAmountAt(snowing, 'snow', 15, 5)).toBeCloseTo(lightSnow);
    expect(weatherAmountAt(snowing, 'rain', 25, 5)).toBe(0);
    const clear = buildAmbientField(sectors, { level: 0, cold: true }, true);
    const cover = new WeatherCover();
    cover.setField(clear);
    cover.advance(0);
    expect(cover.sector(0).snow).toBeCloseTo(WINTER_LYING_SNOW);
    expect(cover.any).toBe(true);
  });
});
