import { describe, expect, it } from 'vitest';
import {
  COVER_SNAP_SECONDS,
  COVER_STEP_SECONDS,
  coverEquilibrium,
  WeatherCover,
} from '../../src/data/weather/cover.js';
import type { WeatherField } from '../../src/data/weather/field.js';

/** A one-sector field with the given `[rain, snow, sand]` amounts. */
function fieldOf(rain: number, snow: number, sand: number): WeatherField {
  return {
    sectorsX: 1,
    sectorsY: 1,
    amounts: Float32Array.from([rain, snow, sand]),
    any: rain + snow + sand > 0,
  };
}

/** Advance `cover` from `from` to `to` game seconds at a 60 fps frame step. */
function run(cover: WeatherCover, from: number, to: number): void {
  for (let t = from; t <= to; t += 1 / 60) cover.advance(t);
}

describe('weather cover', () => {
  it('opens a map at the equilibrium of its field, so a snowy map starts white', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0.3, 0));
    expect(cover.advance(0)).toBe(true);
    expect(cover.sector(0).snow).toBeCloseTo(coverEquilibrium(0, 0.3, 0).snow, 6);
    expect(cover.sector(0).snow).toBe(1);
    expect(cover.texels()[1]).toBe(255);
  });

  it('wets under rain within a minute and dries over minutes after', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0));
    cover.advance(0);
    cover.setField(fieldOf(0.3, 0, 0));
    run(cover, 0, 20);
    const wetAfterRise = cover.sector(0).wet;
    // One rise constant closes about 63% of the gap.
    expect(wetAfterRise).toBeGreaterThan(0.55);
    expect(wetAfterRise).toBeLessThan(0.7);
    run(cover, 20, 120);
    expect(cover.sector(0).wet).toBeGreaterThan(0.99);
    cover.setField(fieldOf(0, 0, 0));
    run(cover, 120, 140);
    const dryDrop = 1 - cover.sector(0).wet;
    expect(dryDrop).toBeGreaterThan(0);
    expect(dryDrop).toBeLessThan(1 - wetAfterRise);
  });

  it('melts snow faster under rain than on a dry day, and the thaw wets the ground', () => {
    const dry = new WeatherCover();
    const rainy = new WeatherCover();
    for (const cover of [dry, rainy]) {
      cover.setField(fieldOf(0, 0.3, 0));
      cover.advance(0);
    }
    dry.setField(fieldOf(0, 0, 0));
    rainy.setField(fieldOf(0.3, 0, 0));
    run(dry, 0, 60);
    run(rainy, 0, 60);
    expect(rainy.sector(0).snow).toBeLessThan(dry.sector(0).snow);
    expect(dry.sector(0).wet).toBeGreaterThan(0);
  });

  it('builds snow over minutes, not seconds', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0));
    cover.advance(0);
    cover.setField(fieldOf(0, 0.3, 0));
    run(cover, 0, 30);
    expect(cover.sector(0).snow).toBeGreaterThan(0.1);
    expect(cover.sector(0).snow).toBeLessThan(0.4);
  });

  it('steps only every few frames and stops once settled', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0));
    cover.advance(0);
    cover.setField(fieldOf(0.3, 0, 0));
    expect(cover.advance(COVER_STEP_SECONDS / 2)).toBe(false);
    expect(cover.advance(COVER_STEP_SECONDS)).toBe(true);
    run(cover, COVER_STEP_SECONDS, 400);
    expect(cover.sector(0).wet).toBe(1);
    expect(cover.advance(401)).toBe(false);
  });

  it('snaps to the equilibrium when the clock jumps back or far ahead', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0));
    cover.advance(100);
    cover.setField(fieldOf(0.3, 0, 0));
    expect(cover.advance(100 + COVER_SNAP_SECONDS + 1)).toBe(true);
    expect(cover.sector(0).wet).toBe(1);
    cover.setField(fieldOf(0, 0, 0));
    expect(cover.advance(50)).toBe(true);
    expect(cover.sector(0).wet).toBe(0);
  });

  it('keeps sleet from settling and rain from lifting dust', () => {
    const both = coverEquilibrium(0.3, 0.3, 0.3);
    expect(both.wet).toBe(1);
    expect(both.snow).toBe(0);
    expect(both.dust).toBe(0);
    expect(coverEquilibrium(0, 0, 0.05).dust).toBe(1);
  });
});
