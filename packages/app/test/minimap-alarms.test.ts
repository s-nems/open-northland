import { describe, expect, it } from 'vitest';
import { ALARM_MS, alarmRing } from '../src/hud/minimap/alarms.js';

describe('alarmRing', () => {
  it('closes in on the hit at full strength, fades at the end, then is gone', () => {
    const opening = alarmRing(0);
    const middle = alarmRing(ALARM_MS / 2);
    const closing = alarmRing(ALARM_MS - 1);
    expect(opening?.alpha).toBe(1);
    expect(middle?.alpha).toBe(1);
    expect(closing?.alpha).toBeLessThan(0.01);
    expect(opening?.radius).toBeGreaterThan(middle?.radius ?? Number.POSITIVE_INFINITY);
    expect(middle?.radius).toBeGreaterThan(closing?.radius ?? Number.POSITIVE_INFINITY);
    expect(alarmRing(ALARM_MS)).toBeNull();
    expect(alarmRing(-1)).toBeNull();
  });
});
