import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  cycleStepAtTick,
  scriptsDayNightCycle,
  scriptsWeatherTints,
} from '../../../src/view/script/day-night.js';

const DAY = 0;
const NIGHT = 58;
const DAYBREAK_TICK = 0;
const NIGHT_SECONDS = 2400;
const CYCLE_SECONDS = 3000;

describe('cycleStepAtTick', () => {
  it('starts at daybreak, reaches the night and comes round', () => {
    expect(cycleStepAtTick(DAYBREAK_TICK).index).toBe(DAY);
    expect(cycleStepAtTick(NIGHT_SECONDS * TICKS_PER_SECOND).index).toBe(NIGHT);
    expect(cycleStepAtTick(CYCLE_SECONDS * TICKS_PER_SECOND).index).toBe(DAY);
  });

  it('answers one object for a whole step', () => {
    expect(cycleStepAtTick(1)).toBe(cycleStepAtTick(TICKS_PER_SECOND));
  });
});

describe('scriptsDayNightCycle', () => {
  const WHOLE_MAP = 900;
  const LOCAL = 9;
  const SUN = 125;
  const OVERCAST = 56;
  const gradeOf = (index: number) => {
    if (index === NIGHT) return [0.5, 0.5, 0.5] as const;
    if (index === SUN) return [1.26, 1.12, 0.92] as const;
    if (index === OVERCAST) return [0.78, 0.78, 0.78] as const;
    return [1, 1, 1] as const;
  };
  const whole = (index: number) => ({ range: WHOLE_MAP, index });

  it('needs a whole-map night and a whole-map sun', () => {
    expect(scriptsDayNightCycle([whole(NIGHT), whole(SUN)], gradeOf)).toBe(true);
    expect(scriptsDayNightCycle([whole(NIGHT)], gradeOf)).toBe(false);
    expect(scriptsDayNightCycle([whole(NIGHT), { range: LOCAL, index: SUN }], gradeOf)).toBe(false);
  });

  it("leaves a weather ramp alone: rain's night without a sun, overcast without a night", () => {
    expect(scriptsDayNightCycle([whole(NIGHT), whole(DAY), whole(OVERCAST)], gradeOf)).toBe(false);
    expect(scriptsDayNightCycle([whole(OVERCAST), whole(SUN)], gradeOf)).toBe(false);
  });
});

describe('scriptsWeatherTints', () => {
  const WHOLE_MAP = 900;
  const LOCAL = 8;
  const TWIN = 2;
  const OVERCAST = 3;
  const palette = [0x808080, 0x808080, 0x808080, 0x717171];

  it('needs two whole-map colours, not two writes or a local one', () => {
    const write = (index: number, range = WHOLE_MAP) => ({ range, index });
    expect(scriptsWeatherTints([write(0), write(OVERCAST)], palette)).toBe(true);
    expect(scriptsWeatherTints([write(0), write(TWIN)], palette)).toBe(false);
    expect(scriptsWeatherTints([write(OVERCAST), write(OVERCAST)], palette)).toBe(false);
    expect(scriptsWeatherTints([write(0), write(OVERCAST, LOCAL)], palette)).toBe(false);
  });
});
