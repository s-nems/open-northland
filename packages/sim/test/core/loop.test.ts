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

  it('counts the ticks the cap discards, so an undeliverable speed is visible', () => {
    const loop = new FixedTimestep(5);
    let steps = 0;

    // Twenty ticks of work in one frame: five run, the remaining backlog is dropped.
    loop.advance(MS_PER_TICK * 20, () => steps++);

    expect(steps).toBe(5);
    expect(loop.droppedTicks).toBe(15);
    expect(loop.maxSteps).toBe(5);
  });

  it('drops nothing while the loop keeps up', () => {
    const loop = new FixedTimestep();
    for (let quarter = 0; quarter < 4; quarter++) loop.advance(250, () => {});
    expect(loop.droppedTicks).toBe(0);
  });

  it('accumulates drops across frames rather than reporting only the last one', () => {
    const loop = new FixedTimestep(5);
    loop.advance(MS_PER_TICK * 10, () => {});
    loop.advance(MS_PER_TICK * 10, () => {});
    expect(loop.droppedTicks).toBe(10);
  });
});
