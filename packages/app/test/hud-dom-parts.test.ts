import { describe, expect, it } from 'vitest';
import { counterStep, counterText } from '../src/hud/dom/parts/counter.js';
import { METER_CRITICAL_BELOW_PCT, METER_LOW_BELOW_PCT, meterTone } from '../src/hud/dom/parts/meter-row.js';

/** The production counter's range: 0 stops, 1..10 counts down, 11 never stops. */
const RANGE = { max: 10, unlimited: 11 };

describe('the counter part', () => {
  it('steps within the finite range', () => {
    expect(counterStep(RANGE, 3, 1, false)).toBe(4);
    expect(counterStep(RANGE, 3, -1, false)).toBe(2);
  });

  it('wraps − at zero to unlimited and steps − from unlimited to the finite top', () => {
    expect(counterStep(RANGE, 0, -1, false)).toBe(RANGE.unlimited);
    expect(counterStep(RANGE, RANGE.unlimited, -1, false)).toBe(RANGE.max);
  });

  it('reaches unlimited past the finite top and stays there', () => {
    expect(counterStep(RANGE, RANGE.max, 1, false)).toBe(RANGE.unlimited);
    expect(counterStep(RANGE, RANGE.unlimited, 1, false)).toBe(RANGE.unlimited);
  });

  it('jumps to the arrow end with Shift', () => {
    expect(counterStep(RANGE, 4, 1, true)).toBe(RANGE.unlimited);
    expect(counterStep(RANGE, 4, -1, true)).toBe(0);
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
