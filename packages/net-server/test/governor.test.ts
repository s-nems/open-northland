import { type ClientLoad, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  GOVERNED_RISE_STEPS,
  GOVERNED_SPEED_STEP,
  GOVERNOR_HEADROOM,
  governedSpeed,
  MIN_GOVERNED_SPEED,
} from '../src/relay/governor.js';
import { createMember, type Member } from '../src/relay/member.js';

const CLOCK_TICK = 100;
const LINK = { delayTicks: 2, roundTripMs: 40 };

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

  it('takes the headroom share of the requested speed before a member reports its load', () => {
    expect(governedSpeed([slowMember('Bartek', null)], CLOCK_TICK, 1)).toEqual({
      nick: 'Bartek',
      speed: GOVERNOR_HEADROOM,
    });
  });

  it('runs at the headroom share of the speed that saturates the slow member', () => {
    expect(governedSpeed([slowMember('Bartek', 2)], CLOCK_TICK, 1)).toEqual({ nick: 'Bartek', speed: 0.4 });
  });

  it('paces for the slowest of several, and for the one furthest behind on a tie', () => {
    const slowest = [slowMember('Bartek', 1.6), slowMember('Cezary', 2)];
    expect(governedSpeed(slowest, CLOCK_TICK, 1)).toEqual({ nick: 'Cezary', speed: 0.4 });
    const tied = [slowMember('Bartek', 2, 60), slowMember('Cezary', 2, 40)];
    expect(governedSpeed(tied, CLOCK_TICK, 1)?.nick).toBe('Cezary');
  });

  it('governs nothing for a member that could keep the requested speed, and never runs below the floor', () => {
    expect(governedSpeed([slowMember('Bartek', 0.1)], CLOCK_TICK, 1)).toBeNull();
    expect(governedSpeed([slowMember('Bartek', 100)], CLOCK_TICK, 1)).toEqual({
      nick: 'Bartek',
      speed: MIN_GOVERNED_SPEED,
    });
  });

  it('releases a member whose share reaches the requested speed even from one step below it', () => {
    const current = { nick: 'Bartek', speed: 1 - GOVERNED_SPEED_STEP };
    expect(governedSpeed([sharing(1)], CLOCK_TICK, 1, current)).toBeNull();
    expect(governedSpeed([sharing(2)], CLOCK_TICK, 1, current)).toBeNull();
  });

  it('slows at once but speeds up only by whole rise steps, so a jittering report changes nothing', () => {
    const current = { nick: 'Bartek', speed: 0.4 };
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

  it('releases a governed clock the requested speed falls to', () => {
    const current = { nick: 'Bartek', speed: 0.4 };
    expect(governedSpeed([sharing(current.speed)], CLOCK_TICK, current.speed, current)).toBeNull();
  });
});
