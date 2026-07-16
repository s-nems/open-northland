import { describe, expect, it } from 'vitest';
import { FixedTimestep, MS_PER_TICK, TICKS_PER_SECOND } from '../../src/core/loop.js';

describe('FixedTimestep', () => {
  it('advances the base game clock at 12 ticks per real-time second', () => {
    const loop = new FixedTimestep();
    let steps = 0;

    for (let quarter = 0; quarter < 4; quarter++) {
      loop.advance(250, () => steps++);
    }

    expect(TICKS_PER_SECOND).toBe(12);
    expect(MS_PER_TICK).toBeCloseTo(1000 / 12);
    expect(steps).toBe(12);
  });

  it('interpolates between the slower sim ticks', () => {
    const loop = new FixedTimestep();
    let steps = 0;

    expect(loop.advance(MS_PER_TICK / 2, () => steps++)).toBeCloseTo(0.5);
    expect(loop.advance(MS_PER_TICK / 2, () => steps++)).toBeCloseTo(0);
    expect(steps).toBe(1);
  });
});
