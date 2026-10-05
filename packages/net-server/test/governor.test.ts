import { type ClientLoad, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_SHARE,
  GOVERNED_RISE_STEPS,
  GOVERNED_SPEED_STEP,
  GOVERNOR_HEADROOM,
  governedSpeed,
  MIN_GOVERNED_SPEED,
} from '../src/relay/governor.js';
import { createMember, type Member } from '../src/relay/member.js';

const CLOCK_TICK = 100;
const LINK = { delayTicks: 2, roundTripMs: 40 };
const FAST_SPEED = 3;
/** `FAST_SPEED` times `CATCH_UP_SHARE`, a whole step. */
const FAST_CATCH_UP_SPEED = 2.4;

/** A member whose sim thread costs `tickCostTicks` ticks of wall time per tick it runs. */
function slowMember(nick: string, tickCostTicks: number | null, ackedTick = 0): Member {
  const member = createMember(`token-${nick}`, nick, 0, LINK);
  const load: ClientLoad | null =
    tickCostTicks === null ? null : { tickMs: TICK_MS * tickCostTicks, buffered: 0 };
  member.load = load;
  member.ackedTick = ackedTick;
  return member;
}

/** A member whose headroom share of its sustainable speed is `share`. */
function sharing(share: number): Member {
  return slowMember('Bartek', GOVERNOR_HEADROOM / share);
}

describe('governed speed', () => {
  it('governs nothing when nobody is slow', () => {
    expect(governedSpeed([], CLOCK_TICK, 1)).toBeNull();
  });

  it('takes the catch-up share of the requested speed before a member reports its load, for its lag', () => {
    expect(governedSpeed([slowMember('Bartek', null)], CLOCK_TICK, 1)).toEqual({
      nick: 'Bartek',
      speed: CATCH_UP_SHARE,
      cause: 'lag',
    });
  });

  it('runs at the headroom share of the speed that saturates the slow member, for its load', () => {
    expect(governedSpeed([slowMember('Bartek', 2)], CLOCK_TICK, 1)).toEqual({
      nick: 'Bartek',
      speed: 0.4,
      cause: 'load',
    });
  });

  it('governs a member whose load says it keeps up at the catch-up share, for its lag', () => {
    expect(governedSpeed([slowMember('Bartek', 0.1)], CLOCK_TICK, FAST_SPEED)).toEqual({
      nick: 'Bartek',
      speed: FAST_CATCH_UP_SPEED,
      cause: 'lag',
    });
  });

  it('paces for the slowest of several, and for the one furthest behind on a tie', () => {
    const slowest = [slowMember('Bartek', 1.6), slowMember('Cezary', 2)];
    expect(governedSpeed(slowest, CLOCK_TICK, 1)).toEqual({ nick: 'Cezary', speed: 0.4, cause: 'load' });
    const tied = [slowMember('Bartek', 2, 60), slowMember('Cezary', 2, 40)];
    expect(governedSpeed(tied, CLOCK_TICK, 1)?.nick).toBe('Cezary');
  });

  it('never runs below the floor, nor above a requested speed under it', () => {
    expect(governedSpeed([slowMember('Bartek', 100)], CLOCK_TICK, 1)).toEqual({
      nick: 'Bartek',
      speed: MIN_GOVERNED_SPEED,
      cause: 'load',
    });
    const underFloor = MIN_GOVERNED_SPEED / 2;
    expect(governedSpeed([slowMember('Bartek', 100)], CLOCK_TICK, underFloor)?.speed).toBe(underFloor);
  });

  it('keeps governing a member whose share reaches the requested speed', () => {
    const current = { nick: 'Bartek', speed: 1 - GOVERNED_SPEED_STEP, cause: 'load' } as const;
    expect(governedSpeed([sharing(2)], CLOCK_TICK, 1, current)).toEqual({
      nick: 'Bartek',
      speed: CATCH_UP_SHARE,
      cause: 'lag',
    });
  });

  it('slows at once but speeds up only by whole rise steps, so a jittering report changes nothing', () => {
    const current = { nick: 'Bartek', speed: 0.4, cause: 'load' } as const;
    const oneStepUp = current.speed + GOVERNED_SPEED_STEP;
    const riseStepsUp = current.speed + GOVERNED_RISE_STEPS * GOVERNED_SPEED_STEP;
    const oneStepDown = current.speed - GOVERNED_SPEED_STEP;
    expect(governedSpeed([sharing(oneStepUp)], CLOCK_TICK, 1, current)).toEqual(current);
    expect(governedSpeed([sharing(riseStepsUp)], CLOCK_TICK, 1, current)?.speed).toBeCloseTo(riseStepsUp);
    expect(governedSpeed([sharing(oneStepDown)], CLOCK_TICK, 1, current)?.speed).toBeCloseTo(oneStepDown);

    const boundary = current.speed + GOVERNED_SPEED_STEP / 2;
    const jitter = GOVERNED_SPEED_STEP / 10;
    let governed = governedSpeed([sharing(boundary - jitter)], CLOCK_TICK, 1);
    expect(governed).toEqual(current);
    for (let report = 0; report < 10; report++) {
      const share = report % 2 === 0 ? boundary + jitter : boundary - jitter;
      governed = governedSpeed([sharing(share)], CLOCK_TICK, 1, governed);
      expect(governed).toEqual(current);
    }
  });

  it('keeps the announced cause while a report jittering around the crossover rounds to one speed', () => {
    const jitter = 0.02;
    const overSaturated = slowMember('Bartek', 1 + jitter);
    const underSaturated = slowMember('Bartek', 1 - jitter);
    let governed = governedSpeed([overSaturated], CLOCK_TICK, 1);
    expect(governed).toEqual({ nick: 'Bartek', speed: CATCH_UP_SHARE, cause: 'load' });
    expect(governedSpeed([underSaturated], CLOCK_TICK, 1)?.cause).toBe('lag');
    for (let report = 0; report < 10; report++) {
      const member = report % 2 === 0 ? underSaturated : overSaturated;
      governed = governedSpeed([member], CLOCK_TICK, 1, governed);
      expect(governed).toEqual({ nick: 'Bartek', speed: CATCH_UP_SHARE, cause: 'load' });
    }
    expect(governedSpeed([slowMember('Cezary', 1 - jitter)], CLOCK_TICK, 1, governed)?.cause).toBe('lag');
  });

  it('follows a requested speed lowered to the governed one down by its catch-up share', () => {
    const current = { nick: 'Bartek', speed: 0.4, cause: 'load' } as const;
    const lowered = governedSpeed([sharing(current.speed)], CLOCK_TICK, current.speed, current);
    expect(lowered).toMatchObject({ nick: 'Bartek', cause: 'lag' });
    expect(lowered?.speed).toBeCloseTo(0.3);
  });
});
