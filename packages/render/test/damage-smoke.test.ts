import { describe, expect, it } from 'vitest';
import { SMOKE_PUFF_PERIOD_TICKS, SMOKE_RISE_PX, smokePuff } from '../src/data/effects/index.js';

describe('smokePuff in weather wind', () => {
  const OLD_PUFF_TICK = SMOKE_PUFF_PERIOD_TICKS - 1;
  const oldest = (wind?: { strength: number; direction: number; gust: number }) => {
    // The oldest puff of the plume is the one furthest up its rise.
    const poses = Array.from({ length: 6 }, (_, puff) => smokePuff(3, 0, puff, OLD_PUFF_TICK, wind));
    return poses.reduce((a, b) => (b.y < a.y ? b : a));
  };

  it('draws still air exactly as no wind', () => {
    expect(smokePuff(3, 1, 2, 17, { strength: 0, direction: 1, gust: 1 })).toEqual(smokePuff(3, 1, 2, 17));
  });

  it('leans the plume downwind and flattens its rise', () => {
    const still = oldest();
    const right = oldest({ strength: 0.8, direction: 1, gust: 0 });
    const left = oldest({ strength: 0.8, direction: -1, gust: 0 });
    expect(right.x).toBeGreaterThan(still.x + SMOKE_RISE_PX / 2);
    expect(left.x).toBeLessThan(still.x - SMOKE_RISE_PX / 2);
    expect(right.y).toBeGreaterThan(still.y);
    expect(right.y).toBeLessThan(0);
  });
});

describe('smokePuff - deterministic rising, swelling, thinning loop', () => {
  it('rises and swells over its loop, staying between the emitter and the rise top', () => {
    // One full period, over which a puff is re-born at the emitter exactly once.
    let wraps = 0;
    let prev = smokePuff(0, 0, 0, 0);
    for (let t = 1; t <= SMOKE_PUFF_PERIOD_TICKS; t++) {
      const cur = smokePuff(0, 0, 0, t);
      expect(cur.y).toBeLessThanOrEqual(0);
      expect(cur.y).toBeGreaterThanOrEqual(-SMOKE_RISE_PX);
      expect(cur.alpha).toBeGreaterThanOrEqual(0);
      if (cur.y > prev.y + 1e-9) {
        wraps++;
      } else {
        expect(cur.radius).toBeGreaterThanOrEqual(prev.radius); // swells as it rises
      }
      prev = cur;
    }
    expect(wraps).toBe(1);
  });
});
