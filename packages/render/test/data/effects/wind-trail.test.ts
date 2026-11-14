import { describe, expect, it } from 'vitest';
import {
  WIND_GUST_FRAME_H,
  WIND_GUST_FRAME_W,
  WIND_GUST_FRAMES,
  WIND_GUST_LIFE_TICKS,
  WIND_GUST_SHAPES,
  WIND_GUST_TEXELS_PER_PX,
  windGust,
  windGustFrame,
  windGustSheet,
  windGustStretch,
  windGustTailX,
  windGustTailY,
} from '../../../src/data/effects/index.js';

const RGBA = 4;
const FRAME_W = WIND_GUST_FRAME_W * WIND_GUST_TEXELS_PER_PX;
const FRAME_H = WIND_GUST_FRAME_H * WIND_GUST_TEXELS_PER_PX;
const WALKER = 7;

/** The summed opacity of one frame of one shape, and the sheet x of its rightmost painted texel. */
function frameInk(sheet: Uint8Array, shape: number, frame: number): { ink: number; reach: number } {
  let ink = 0;
  let reach = -1;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const alpha =
        sheet[((shape * FRAME_H + y) * FRAME_W * WIND_GUST_FRAMES + frame * FRAME_W + x) * RGBA + 3];
      if (alpha === undefined || alpha === 0) continue;
      ink += alpha;
      reach = Math.max(reach, x);
    }
  }
  return { ink, reach };
}

describe('wind trail', () => {
  it('plays every frame once over a gust life', () => {
    expect(windGustFrame(-0.1)).toBe(-1);
    expect(windGustFrame(0)).toBe(0);
    expect(windGustFrame(WIND_GUST_LIFE_TICKS - 0.01)).toBe(WIND_GUST_FRAMES - 1);
    expect(windGustFrame(WIND_GUST_LIFE_TICKS)).toBe(-1);
  });

  it('paints a stroke in every frame of every shape, its head running on from the tail', () => {
    const sheet = windGustSheet();
    expect(sheet).toHaveLength(FRAME_W * WIND_GUST_FRAMES * FRAME_H * WIND_GUST_SHAPES * RGBA);
    const last = WIND_GUST_FRAMES - 1;
    const middle = Math.floor(WIND_GUST_FRAMES / 2);
    for (let shape = 0; shape < WIND_GUST_SHAPES; shape++) {
      const start = frameInk(sheet, shape, 0);
      const mid = frameInk(sheet, shape, middle);
      for (let frame = 0; frame < last; frame++) expect(frameInk(sheet, shape, frame).ink).toBeGreaterThan(0);
      expect(mid.reach).toBeGreaterThan(start.reach);
      expect(mid.ink).toBeGreaterThan(start.ink);
      expect(mid.ink).toBeGreaterThan(frameInk(sheet, shape, last).ink);
    }
  });

  it('keeps the sheet premultiplied', () => {
    const sheet = windGustSheet();
    for (let i = 0; i < sheet.length; i += RGBA) {
      const alpha = sheet[i + 3] ?? 0;
      expect(Math.max(sheet[i] ?? 0, sheet[i + 1] ?? 0, sheet[i + 2] ?? 0)).toBeLessThanOrEqual(alpha);
    }
  });

  it('runs three gusts in a row in three different lanes', () => {
    const lanes = [0, 1, 2].map((index) => windGust(WALKER, index).lane);
    const sorted = [...lanes].sort((a, b) => a - b);
    expect(sorted[0]).toBeLessThan(-5);
    expect(Math.abs(sorted[1] ?? Number.NaN)).toBeLessThan(5);
    expect(sorted[2]).toBeGreaterThan(5);
  });

  it('starts a gust behind its walker, and over the head of one coming down the screen', () => {
    // Heading right: left of the feet, on the body.
    expect(windGustTailX(0, 1, 0)).toBeLessThan(0);
    expect(windGustTailY(0, 1, 0)).toBeLessThan(0);
    // Heading left: right of the feet.
    expect(windGustTailX(0, -1, 0)).toBeGreaterThan(0);
    // Down the screen the body hides its own back, so the gust starts higher than for a walk up it.
    expect(windGustTailY(0, 0, 1)).toBeLessThan(windGustTailY(0, 1, 0));
    expect(windGustTailY(0, 0, -1)).toBeGreaterThan(windGustTailY(0, 1, 0));
  });

  it('stretches a gust with its walker speed, within bounds', () => {
    expect(windGustStretch(8)).toBeGreaterThan(windGustStretch(4));
    expect(windGustStretch(1000)).toBe(windGustStretch(100));
    expect(windGustStretch(0)).toBeGreaterThan(0);
  });
});
