import { describe, expect, it } from 'vitest';
import {
  CHIMNEY_COOL_TICKS,
  CHIMNEY_HOLD_TICKS,
  CHIMNEY_KINDLE_TICKS,
  stokeChimney,
  tendedHearthsOf,
} from '../../../src/data/scene/chimney-smoke.js';
import { entity, snapshotOf } from '../../support/fixtures.js';

const WORKSHOP = 9;
const HOME = 12;
const crafting = { CurrentAtomic: { effect: { kind: 'produce' }, targetEntity: WORKSHOP, duration: 40 } };

describe('tendedHearthsOf', () => {
  it('counts who crafts inside a building or eats a meal of it, and nobody else', () => {
    const snapshot = snapshotOf([
      entity(1, 1, 1, crafting),
      entity(2, 1, 1, crafting),
      entity(3, 2, 2, { CurrentAtomic: { effect: { kind: 'eat', goodType: 3, from: HOME } } }),
      entity(4, 2, 2, { CurrentAtomic: { effect: { kind: 'eat', goodType: 3, from: null } } }),
      entity(5, 3, 3, { CurrentAtomic: { effect: { kind: 'pickup', from: WORKSHOP }, duration: 10 } }),
      entity(6, 3, 3, {}),
    ]);
    expect([...tendedHearthsOf(snapshot)]).toEqual([
      [WORKSHOP, 2],
      [HOME, 1],
    ]);
  });
});

describe('stokeChimney', () => {
  it('kindles while someone works, holds through a pause, then cools to nothing', () => {
    const fire = { draught: 0, hold: 0 };
    stokeChimney(fire, true, CHIMNEY_KINDLE_TICKS / 2);
    expect(fire.draught).toBeCloseTo(0.5);
    stokeChimney(fire, true, CHIMNEY_KINDLE_TICKS);
    expect(fire.draught).toBe(1);
    stokeChimney(fire, false, CHIMNEY_HOLD_TICKS);
    expect(fire.draught).toBe(1);
    stokeChimney(fire, false, CHIMNEY_COOL_TICKS / 4);
    expect(fire.draught).toBeCloseTo(0.75);
    stokeChimney(fire, false, CHIMNEY_COOL_TICKS);
    expect(fire.draught).toBe(0);
  });

  it('ignores a clock that ran backwards', () => {
    const fire = { draught: 0.4, hold: 0 };
    stokeChimney(fire, false, -50);
    expect(fire.draught).toBe(0.4);
  });
});
