import { describe, expect, it } from 'vitest';
import { boltPaths } from '../../src/gpu/weather/lightning-bolt.js';

const STRIKE = { id: 41, atSeconds: 0, screenX: 0.4, screenY: 0.8, distance: 0.1 };
const SCREEN_W = 1280;
const SCREEN_H = 720;

describe('lightning bolt', () => {
  it('is the same bolt for the same strike', () => {
    expect(boltPaths(STRIKE, SCREEN_W, SCREEN_H)).toEqual(boltPaths(STRIKE, SCREEN_W, SCREEN_H));
  });

  it('runs its main channel from above the screen to the strike point, with branches', () => {
    const paths = boltPaths(STRIKE, SCREEN_W, SCREEN_H);
    const main = paths.find((path) => path.generation === 0);
    const end = main?.points.at(-1);
    expect(main?.points[0]?.[1]).toBeLessThan(0);
    expect(end?.[0]).toBeCloseTo(STRIKE.screenX * SCREEN_W);
    expect(end?.[1]).toBeCloseTo(STRIKE.screenY * SCREEN_H);
    expect(paths.some((path) => path.generation > 0)).toBe(true);
  });

  it('keeps the channel jagged, not a straight line', () => {
    const main = boltPaths(STRIKE, SCREEN_W, SCREEN_H).find((path) => path.generation === 0);
    const points = main?.points ?? [];
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1] ?? [0, 0];
      const [bx, by] = points[i] ?? [0, 0];
      walked += Math.hypot(bx - ax, by - ay);
    }
    const [sx, sy] = points[0] ?? [0, 0];
    const [ex, ey] = points.at(-1) ?? [0, 0];
    expect(walked).toBeGreaterThan(1.2 * Math.hypot(ex - sx, ey - sy));
  });
});
