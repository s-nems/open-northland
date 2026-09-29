import { describe, expect, it } from 'vitest';
import {
  PARTICLE_CAP,
  PARTICLE_CAPACITY_STEP,
  particleCapacity,
  particleCount,
  weatherIntensity,
} from '../../src/data/weather/precipitation.js';

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
    expect(capacity % PARTICLE_CAPACITY_STEP === 0 || capacity === PARTICLE_CAP).toBe(true);
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      expect(particleCount('sand', 1920, 1080, 1, zoom)).toBeLessThanOrEqual(capacity);
    }
    expect(particleCount('rain', 8000, 8000, 1, 0.25)).toBe(PARTICLE_CAP);
    expect(particleCapacity('rain', 8000, 8000)).toBe(PARTICLE_CAP);
  });
});
