import { describe, expect, it } from 'vitest';
import {
  COVER_SNAP_SECONDS,
  COVER_STEP_SECONDS,
  coverEquilibrium,
  SAND_SATURATING_AMOUNT,
  WeatherCover,
} from '../../src/data/weather/cover.js';
import type { WeatherField } from '../../src/data/weather/field.js';

/** A one-sector field with the given `[rain, snow, sand]` amounts and lying snow. */
function fieldOf(rain: number, snow: number, sand: number, lyingSnow = 0): WeatherField {
  return {
    sectorsX: 1,
    sectorsY: 1,
    amounts: Float32Array.from([rain, snow, sand]),
    any: rain + snow + sand > 0,
    lyingSnow,
  };
}

/** Advance `cover` from `from` to `to` game seconds in steps of `step`. */
function runSteps(cover: WeatherCover, from: number, to: number, step: number): void {
  for (let t = from + step; t <= to + step / 2; t += step) cover.advance(t);
}

/** A cover settled under full snow at time 0, then under light rain that melts it. */
function thawingCover(): WeatherCover {
  const cover = new WeatherCover();
  cover.setField(fieldOf(0, 0.5, 0));
  cover.advance(0);
  cover.setField(fieldOf(LIGHT_RAIN, 0, 0));
  return cover;
}

/** Rain light enough that the snow's thaw, not the rain, sets the wetness at first. */
const LIGHT_RAIN = 0.05;
/** Largest difference allowed between a finely and a coarsely stepped cover. */
const STEP_TOLERANCE = 0.02;

/** Advance `cover` from `from` to `to` game seconds at a 60 fps frame step. */
function run(cover: WeatherCover, from: number, to: number): void {
  for (let t = from; t <= to; t += 1 / 60) cover.advance(t);
}

describe('weather cover', () => {
  it('opens a map at the equilibrium of its field, so a snowy map starts white', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0.5, 0));
    expect(cover.advance(0)).toBe(true);
    expect(cover.sector(0).snow).toBeCloseTo(coverEquilibrium(0, 0.5, 0).snow, 6);
    expect(cover.sector(0).snow).toBe(1);
    expect(cover.texels()[1]).toBe(255);
  });

  it('opens at the equilibrium of the last field set before the first step', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0.5));
    cover.setField(fieldOf(0, 0.5, 0));
    cover.advance(0);
    expect(cover.sector(0).snow).toBe(1);
  });

  it('wets under rain within a minute and dries over minutes after', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0));
    cover.advance(0);
    cover.setField(fieldOf(0.5, 0, 0));
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
      cover.setField(fieldOf(0, 0.5, 0));
      cover.advance(0);
    }
    dry.setField(fieldOf(0, 0, 0));
    rainy.setField(fieldOf(0.5, 0, 0));
    run(dry, 0, 60);
    run(rainy, 0, 60);
    expect(rainy.sector(0).snow).toBeLessThan(dry.sector(0).snow);
    expect(dry.sector(0).wet).toBeGreaterThan(0);
  });

  it('carries the rain falling now in alpha, apart from the wetness it leaves', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0.5, 0, 0));
    cover.advance(0);
    expect(cover.texels()[3]).toBe(255);
    cover.setField(fieldOf(0, 0, 0));
    run(cover, 0, 1);
    const texels = cover.texels();
    expect(texels[3]).toBe(0);
    expect(texels[0]).toBeGreaterThan(200);
  });

  it('builds snow over minutes, not seconds', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0));
    cover.advance(0);
    cover.setField(fieldOf(0, 0.5, 0));
    run(cover, 0, 30);
    expect(cover.sector(0).snow).toBeGreaterThan(0.1);
    expect(cover.sector(0).snow).toBeLessThan(0.4);
  });

  it('steps only every few frames and stops once settled', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0));
    cover.advance(0);
    cover.setField(fieldOf(0.5, 0, 0));
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
    cover.setField(fieldOf(0.5, 0, 0));
    expect(cover.advance(100 + COVER_SNAP_SECONDS + 1)).toBe(true);
    expect(cover.sector(0).wet).toBe(1);
    cover.setField(fieldOf(0, 0, 0));
    expect(cover.advance(50)).toBe(true);
    expect(cover.sector(0).wet).toBe(0);
  });

  it('leaves a light scripted fall short of the full cover a heavy one brings', () => {
    const light = coverEquilibrium(0.1, 0.1, 0.03);
    expect(light.wet).toBeLessThan(0.6);
    expect(light.snow).toBeLessThan(0.6);
    expect(light.dust).toBeLessThan(0.6);
    expect(coverEquilibrium(0, 0.1, 0).snow).toBeGreaterThan(0.3);
  });

  it('keeps sleet from settling and rain from lifting dust', () => {
    const both = coverEquilibrium(0.5, 0.5, 0.5);
    expect(both.wet).toBe(1);
    expect(both.snow).toBe(0);
    expect(both.dust).toBe(0);
    expect(coverEquilibrium(0, 0, SAND_SATURATING_AMOUNT).dust).toBe(1);
  });

  it('keeps lying snow under a clear sky and gives it up to rain, which the thaw wets', () => {
    const lying = 0.6;
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0, 0, lying));
    cover.advance(0);
    expect(cover.sector(0).snow).toBeCloseTo(lying, 6);
    runSteps(cover, 0, 300, COVER_STEP_SECONDS);
    expect(cover.sector(0).snow).toBeCloseTo(lying, 6);
    expect(cover.sector(0).wet).toBe(0);
    cover.setField(fieldOf(0.5, 0, 0, lying));
    runSteps(cover, 300, 330, COVER_STEP_SECONDS);
    expect(cover.sector(0).snow).toBeLessThan(lying);
    expect(cover.sector(0).wet).toBeGreaterThan(0);
    runSteps(cover, 330, 900, COVER_STEP_SECONDS);
    expect(cover.sector(0).snow).toBeLessThan(0.01);
  });

  it('wets the ground from the thaw of lying snow even without rain', () => {
    const cover = new WeatherCover();
    cover.setField(fieldOf(0, 0.5, 0, 0.2));
    cover.advance(0);
    cover.setField(fieldOf(0, 0, 0, 0.2));
    runSteps(cover, 0, 60, COVER_STEP_SECONDS);
    expect(cover.sector(0).snow).toBeGreaterThan(0.2);
    expect(cover.sector(0).wet).toBeGreaterThan(0);
  });

  it('comes out the same whether it steps finely or coarsely', () => {
    const fine = thawingCover();
    const coarse = thawingCover();
    runSteps(fine, 0, 120, COVER_STEP_SECONDS);
    runSteps(coarse, 0, 120, 10);
    for (const key of ['wet', 'snow', 'dust'] as const)
      expect(Math.abs(fine.sector(0)[key] - coarse.sector(0)[key])).toBeLessThan(STEP_TOLERANCE);
  });

  it('integrates a long gap, like a hidden tab, in sub-steps so the thaw follows the melt', () => {
    const fine = thawingCover();
    const jump = thawingCover();
    const gap = COVER_SNAP_SECONDS / 2;
    runSteps(fine, 0, gap, COVER_STEP_SECONDS);
    jump.advance(gap);
    expect(Math.abs(fine.sector(0).wet - jump.sector(0).wet)).toBeLessThan(STEP_TOLERANCE);
    expect(Math.abs(fine.sector(0).snow - jump.sector(0).snow)).toBeLessThan(STEP_TOLERANCE);
  });
});
