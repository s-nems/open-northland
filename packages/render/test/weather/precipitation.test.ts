import { describe, expect, it } from 'vitest';
import {
  PARTICLE_CAP,
  PARTICLE_CAP_SCREEN,
  PARTICLE_CAPACITY_STEP,
  PARTICLE_WRAP_MARGIN_PX,
  PRECIPITATION_TIME_SPLIT_SECONDS,
  PRECIPITATION_WIND_SPLIT_PX,
  PrecipitationTravel,
  particleCapacity,
  particleCount,
  splitCoarse,
  weatherIntensity,
  zoomSize,
} from '../../src/data/weather/precipitation.js';
import { WEATHER_KINDS } from '../../src/data/weather/types.js';

describe('weather intensity', () => {
  it('shows light real-map weather gently and saturates at the heaviest', () => {
    expect(weatherIntensity('rain', 0)).toBe(0);
    expect(weatherIntensity('rain', 0.05)).toBeGreaterThan(0.15);
    expect(weatherIntensity('rain', 0.05)).toBeLessThan(0.3);
    expect(weatherIntensity('sand', 0.02)).toBeGreaterThan(0.3);
    expect(weatherIntensity('snow', 0.3)).toBeGreaterThan(0.85);
    expect(weatherIntensity('rain', 1)).toBe(1);
  });
});

describe('particle budget', () => {
  it('follows screen area and intensity', () => {
    const small = particleCount('rain', 800, 600, 1, 1);
    const big = particleCount('rain', 1920, 1080, 1, 1);
    expect(big).toBeGreaterThan(2.5 * small);
    expect(particleCount('rain', 1920, 1080, 0.5, 1)).toBeCloseTo(big / 2, -1);
    expect(particleCount('rain', 1920, 1080, 0, 1)).toBe(0);
  });

  it('thickens in a storm, still inside the buffer', () => {
    const calm = particleCount('snow', 1920, 1080, 1, 1);
    const storm = particleCount('snow', 1920, 1080, 1, 1, 1);
    expect(storm).toBeGreaterThan(1.4 * calm);
    expect(particleCount('snow', 1920, 1080, 1, 0.1, 1)).toBeLessThanOrEqual(
      particleCapacity('snow', 1920, 1080),
    );
  });

  it('draws more particles zoomed out, within bounds', () => {
    const base = particleCount('snow', 1920, 1080, 1, 1);
    expect(particleCount('snow', 1920, 1080, 1, 0.5)).toBeGreaterThan(base);
    expect(particleCount('snow', 1920, 1080, 1, 0.01)).toBeLessThanOrEqual(Math.ceil(base * 1.5) + 1);
  });

  it('sizes the buffer for any zoom in whole steps, under the cap', () => {
    const capacity = particleCapacity('sand', 1920, 1080);
    expect(capacity % PARTICLE_CAPACITY_STEP).toBe(0);
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      expect(particleCount('sand', 1920, 1080, 1, zoom)).toBeLessThanOrEqual(capacity);
    }
    expect(particleCount('rain', 8000, 8000, 1, 0.25)).toBe(PARTICLE_CAP.rain);
    expect(particleCapacity('rain', 8000, 8000)).toBe(PARTICLE_CAP.rain);
  });

  it('never caps a full storm at any zoom up to 1440p', () => {
    const { width, height } = PARTICLE_CAP_SCREEN;
    for (const kind of WEATHER_KINDS) {
      for (const zoom of [0.1, 0.5, 1, 2]) {
        expect(particleCount(kind, width, height, 1, zoom, 1)).toBeLessThan(PARTICLE_CAP[kind]);
      }
    }
  });
});

/** GLSL `mod`: the result takes the divisor's sign. */
const glslMod = (x: number, y: number): number => x - y * Math.floor(x / y);
const f32 = Math.fround;

/** Mirror of the shader's `wrapped()` along y, with the uniforms rounded to float32 as uploaded. */
function wrappedY(travel: PrecipitationTravel, seedY: number, fall: number, windShare: number): number {
  const box = 1080 + 2 * PARTICLE_WRAP_MARGIN_PX;
  const coarseFall = splitCoarse(travel.fall, PRECIPITATION_TIME_SPLIT_SECONDS);
  const coarseWind = splitCoarse(travel.scaledWindY, PRECIPITATION_WIND_SPLIT_PX);
  const moved =
    glslMod(f32(fall * f32(coarseFall)), box) +
    fall * f32(travel.fall - coarseFall) +
    glslMod(f32(f32(coarseWind) * windShare), box) +
    f32(travel.scaledWindY - coarseWind) * windShare;
  return glslMod(seedY * box + moved, box);
}

/** Distance between two positions on a wrap of `box`. */
function wrapGap(a: number, b: number, box: number): number {
  const d = Math.abs(a - b) % box;
  return Math.min(d, box - d);
}

describe('precipitation travel', () => {
  const FRAME = 1 / 60;
  const BOX = 1080 + 2 * PARTICLE_WRAP_MARGIN_PX;
  // A near raindrop: fast, following the wind.
  const FALL = 860;
  const WIND_SHARE = 1.6;
  const WIND_Y = 40;
  // Farther than one frame of the fastest particle at the largest zoom scale, with slack for float32.
  const STEP_LIMIT = 2 * (FALL + WIND_Y * WIND_SHARE) * zoomSize(4) * FRAME;

  it('keeps a particle in place when the zoom changes late in a game', () => {
    const travel = new PrecipitationTravel();
    const hour = 3600;
    for (let t = 0; t < hour; t += FRAME) travel.advance(FRAME, 0, WIND_Y, zoomSize(1));
    const before = wrappedY(travel, 0.3, FALL, WIND_SHARE);
    travel.advance(FRAME, 0, WIND_Y, zoomSize(4));
    const after = wrappedY(travel, 0.3, FALL, WIND_SHARE);
    expect(wrapGap(before, after, BOX)).toBeLessThan(STEP_LIMIT);
    expect(wrapGap(before, after, BOX)).toBeGreaterThan(0);
  });

  it('moves continuously across a coarse split', () => {
    const travel = new PrecipitationTravel();
    travel.fall = PRECIPITATION_TIME_SPLIT_SECONDS - FRAME / 2;
    travel.scaledWindY = PRECIPITATION_WIND_SPLIT_PX - FRAME / 2;
    const before = wrappedY(travel, 0.7, FALL, WIND_SHARE);
    travel.advance(FRAME, 0, WIND_Y, zoomSize(1));
    expect(splitCoarse(travel.fall, PRECIPITATION_TIME_SPLIT_SECONDS)).toBe(PRECIPITATION_TIME_SPLIT_SECONDS);
    const after = wrappedY(travel, 0.7, FALL, WIND_SHARE);
    expect(wrapGap(before, after, BOX)).toBeLessThan(STEP_LIMIT);
  });
});
