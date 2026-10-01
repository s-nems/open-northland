import { PRODUCTION_COUNT_MAX, PRODUCTION_UNLIMITED } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  COUNTER_TENS_STEP,
  counterModifiers,
  counterStep,
  counterText,
} from '../src/hud/dom/parts/counter.js';
import {
  METER_CRITICAL_BELOW_PCT,
  METER_LOW_BELOW_PCT,
  meterFill,
  meterTone,
} from '../src/hud/dom/parts/meter-row.js';
import { selectionBottomInset } from '../src/hud/dom/selection-panel.js';
import { NAV_BEAM_H } from '../src/hud/nav-beam.js';

/** The production counter's range: 0 stops, the finite counts count down, the sentinel never stops. */
const RANGE = { max: PRODUCTION_COUNT_MAX, unlimited: PRODUCTION_UNLIMITED };
const PLAIN = { jump: false, tens: false };
const JUMP = { jump: true, tens: false };
const TENS = { jump: false, tens: true };

describe('the counter part', () => {
  it('steps within the finite range', () => {
    expect(counterStep(RANGE, 3, 1, PLAIN)).toBe(4);
    expect(counterStep(RANGE, 3, -1, PLAIN)).toBe(2);
  });

  it('wraps − at zero to unlimited and steps − from unlimited to the finite top', () => {
    expect(counterStep(RANGE, 0, -1, PLAIN)).toBe(RANGE.unlimited);
    expect(counterStep(RANGE, RANGE.unlimited, -1, PLAIN)).toBe(RANGE.max);
  });

  it('reaches unlimited past the finite top and wraps back to 0 from it', () => {
    expect(counterStep(RANGE, RANGE.max, 1, PLAIN)).toBe(RANGE.unlimited);
    expect(counterStep(RANGE, RANGE.unlimited, 1, PLAIN)).toBe(0);
  });

  it('jumps to the arrow end with Shift', () => {
    expect(counterStep(RANGE, 4, 1, JUMP)).toBe(RANGE.unlimited);
    expect(counterStep(RANGE, 4, -1, JUMP)).toBe(0);
  });

  it('steps by tens with Ctrl, clamped to the finite range and wrapping at its ends', () => {
    expect(counterStep(RANGE, 30, 1, TENS)).toBe(30 + COUNTER_TENS_STEP);
    expect(counterStep(RANGE, 30, -1, TENS)).toBe(30 - COUNTER_TENS_STEP);
    expect(counterStep(RANGE, 95, 1, TENS)).toBe(RANGE.max);
    expect(counterStep(RANGE, 5, -1, TENS)).toBe(0);
    expect(counterStep(RANGE, RANGE.max, 1, TENS)).toBe(RANGE.unlimited);
    expect(counterStep(RANGE, 0, -1, TENS)).toBe(RANGE.unlimited);
    expect(counterStep(RANGE, RANGE.unlimited, -1, TENS)).toBe(RANGE.max);
    expect(counterStep(RANGE, RANGE.unlimited, 1, TENS)).toBe(0);
  });

  it('starts a range at its minimum, wrapping − there to unlimited and + at unlimited back to it', () => {
    const ceiling = { min: 1, max: 100, unlimited: 101 };
    expect(counterStep(ceiling, 1, -1, PLAIN)).toBe(ceiling.unlimited);
    expect(counterStep(ceiling, ceiling.unlimited, 1, PLAIN)).toBe(ceiling.min);
    expect(counterStep(ceiling, 4, -1, JUMP)).toBe(ceiling.min);
    expect(counterStep(ceiling, 5, -1, TENS)).toBe(ceiling.min);
  });

  it('clamps a range without unlimited at both ends and never shows ∞', () => {
    const reserve = { max: 100 };
    expect(counterStep(reserve, 0, -1, PLAIN)).toBe(0);
    expect(counterStep(reserve, reserve.max, 1, PLAIN)).toBe(reserve.max);
    expect(counterStep(reserve, 95, 1, TENS)).toBe(reserve.max);
    expect(counterStep(reserve, 4, 1, JUMP)).toBe(reserve.max);
    expect(counterStep(reserve, 4, -1, JUMP)).toBe(0);
    expect(counterText(reserve, 0)).toBe('0');
  });

  it('reads Shift as the jump by default and Ctrl or Cmd as the jump on a production counter', () => {
    const click = (mods: Partial<MouseEvent>): MouseEvent =>
      ({ shiftKey: false, ctrlKey: false, metaKey: false, ...mods }) as MouseEvent;
    expect(counterModifiers(click({ shiftKey: true }))).toEqual(JUMP);
    expect(counterModifiers(click({ ctrlKey: true }))).toEqual(TENS);
    expect(counterModifiers(click({ ctrlKey: true }), 'ctrl')).toEqual(JUMP);
    expect(counterModifiers(click({ metaKey: true }), 'ctrl')).toEqual(JUMP);
    expect(counterModifiers(click({ shiftKey: true }), 'ctrl')).toEqual(TENS);
  });

  it('shows unlimited as the infinity sign', () => {
    expect(counterText(RANGE, RANGE.unlimited)).toBe('∞');
    expect(counterText(RANGE, 7)).toBe('7');
  });
});

describe('the meter row tone', () => {
  it('reads amber under a third and red under a sixth', () => {
    expect(meterTone(METER_LOW_BELOW_PCT)).toBe('ok');
    expect(meterTone(METER_LOW_BELOW_PCT - 1)).toBe('low');
    expect(meterTone(METER_CRITICAL_BELOW_PCT)).toBe('low');
    expect(meterTone(METER_CRITICAL_BELOW_PCT - 1)).toBe('critical');
  });
});

describe('the meter fill', () => {
  const SHELF = 40;
  it('is a capped CSS percentage that survives an empty whole', () => {
    expect(meterFill(SHELF / 2, SHELF)).toBe('50%');
    expect(meterFill(SHELF * 2, SHELF)).toBe('100%');
    expect(meterFill(0, 0)).toBe('0%');
  });
});

describe('the selection panel placement', () => {
  const HEIGHT = 810;
  it('stands on the plane bottom while the beam stays clear of its column', () => {
    expect(selectionBottomInset({ width: 1440, height: HEIGHT })).toBe(0);
    expect(selectionBottomInset({ width: 1056, height: HEIGHT })).toBe(0);
  });

  it('lifts above the beam once the beam reaches under it', () => {
    expect(selectionBottomInset({ width: 1055, height: HEIGHT })).toBe(NAV_BEAM_H);
  });
});
