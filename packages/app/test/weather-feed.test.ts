import type { WeatherField } from '@open-northland/render';
import { weatherAmountAt } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import { createWeatherFeed } from '../src/view/weather-feed.js';

const MAP = { width: 50, height: 50 };
const WHOLE = { min: { hx: 0, hy: 0 }, max: { hx: 99, hy: 99 } };
const CORNER = { min: { hx: 0, hy: 0 }, max: { hx: 20, hy: 20 } };

describe('createWeatherFeed', () => {
  it('rebuilds the field in write order, a repeated extent moving to the end', () => {
    let field: WeatherField | null = null;
    const feed = createWeatherFeed(MAP, (next) => {
      field = next;
    });
    feed.write({ weather: 'rain', ...WHOLE, density: 10000 });
    feed.write({ weather: 'rain', ...CORNER, density: 0 });
    feed.write({ weather: 'rain', ...WHOLE, density: 5000 });
    const built = field as WeatherField | null;
    if (built === null) throw new Error('no field');
    // The whole-map write came last, so it covers the corner's clear.
    expect(weatherAmountAt(built, 'rain', 5, 5)).toBeCloseTo(0.5);
    expect(weatherAmountAt(built, 'rain', 95, 95)).toBeCloseTo(0.5);
  });
});

describe('weather override', () => {
  it('lies over every write and clears the other kinds', () => {
    let field: WeatherField | null = null;
    const feed = createWeatherFeed(
      MAP,
      (next) => {
        field = next;
      },
      { kind: 'snow', percent: 40 },
    );
    feed.write({ weather: 'rain', ...WHOLE, density: 10000 });
    const built = field as WeatherField | null;
    if (built === null) throw new Error('no field');
    expect(weatherAmountAt(built, 'snow', 50, 50)).toBeCloseTo(0.4);
    expect(weatherAmountAt(built, 'rain', 50, 50)).toBe(0);
  });
});
