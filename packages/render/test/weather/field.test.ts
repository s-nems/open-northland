import { describe, expect, it } from 'vitest';
import { buildWeatherField, weatherAmountAt, weatherFieldTexels } from '../../src/data/weather/field.js';

const MAP_NODES = 100;

describe('weather field', () => {
  it('is dry without regions', () => {
    const field = buildWeatherField([], MAP_NODES, MAP_NODES);
    expect(field.any).toBe(false);
    expect(weatherAmountAt(field, 'rain', 50, 50)).toBe(0);
  });

  it('covers the whole map and scales density to 0..1', () => {
    const field = buildWeatherField(
      [{ weather: 'snow', min: { hx: -10, hy: -10 }, max: { hx: 200, hy: 200 }, density: 2500 }],
      MAP_NODES,
      MAP_NODES,
    );
    expect(weatherAmountAt(field, 'snow', 0, 0)).toBeCloseTo(0.25);
    expect(weatherAmountAt(field, 'snow', 99, 99)).toBeCloseTo(0.25);
    expect(weatherAmountAt(field, 'rain', 50, 50)).toBe(0);
  });

  it('lets a later write win, including a zero clear', () => {
    const field = buildWeatherField(
      [
        { weather: 'rain', min: { hx: 0, hy: 0 }, max: { hx: 99, hy: 99 }, density: 10000 },
        { weather: 'rain', min: { hx: 0, hy: 0 }, max: { hx: 20, hy: 20 }, density: 0 },
      ],
      MAP_NODES,
      MAP_NODES,
    );
    expect(weatherAmountAt(field, 'rain', 5, 5)).toBe(0);
    expect(weatherAmountAt(field, 'rain', 95, 95)).toBe(1);
  });

  it('blends bilinearly between sector centres', () => {
    const field = buildWeatherField(
      [{ weather: 'sand', min: { hx: 0, hy: 0 }, max: { hx: 9, hy: 99 }, density: 10000 }],
      MAP_NODES,
      MAP_NODES,
    );
    expect(weatherAmountAt(field, 'sand', 5, 50)).toBe(1);
    expect(weatherAmountAt(field, 'sand', 10, 50)).toBeCloseTo(0.5);
    expect(weatherAmountAt(field, 'sand', 15, 50)).toBe(0);
  });

  it('packs one RGBA texel per sector', () => {
    const field = buildWeatherField(
      [{ weather: 'snow', min: { hx: 0, hy: 0 }, max: { hx: 99, hy: 99 }, density: 10000 }],
      MAP_NODES,
      MAP_NODES,
    );
    const texels = weatherFieldTexels(field);
    expect(texels.length).toBe(field.sectorsX * field.sectorsY * 4);
    expect([...texels.slice(0, 4)]).toEqual([0, 255, 0, 255]);
  });
});
