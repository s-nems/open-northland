import { type ClientLoad, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { GOVERNOR_HEADROOM, governedSpeed, MIN_GOVERNED_SPEED } from '../src/relay/governor.js';
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
});
