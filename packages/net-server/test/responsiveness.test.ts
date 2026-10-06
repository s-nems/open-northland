import { describe, expect, it } from 'vitest';
import { createMember } from '../src/relay/member.js';
import { automaticBufferTicks, Responsiveness } from '../src/relay/responsiveness.js';
import { startedRoom, startingRoom, TOKEN_B } from './support/message-stage.js';

function measured(roundTripMs: number, jitterMs = 0) {
  return {
    ...createMember('member-0123456789', 'A', 0, { delayTicks: 2, roundTripMs, jitterMs, measured: true }),
    seat: 0,
    loaded: true,
  };
}

describe('room responsiveness policy', () => {
  it('keeps stable high latency responsive and reserves more for a lower but erratic round trip', () => {
    expect(automaticBufferTicks([measured(300)], 1)).toBe(1);
    expect(automaticBufferTicks([measured(100, 70)], 1)).toBe(2);
    expect(automaticBufferTicks([measured(40, 2), measured(100, 70)], 1)).toBe(2);
  });

  it('uses the effective tick duration and bounds the reserve', () => {
    const members = [measured(120, 20)];
    expect(automaticBufferTicks(members, 1)).toBe(1);
    expect(automaticBufferTicks(members, 4)).toBe(3);
    expect(automaticBufferTicks(members, 8)).toBe(5);
    expect(automaticBufferTicks([measured(5000, 2000)], 8)).toBe(6);
  });

  it('keeps two ticks for an unmeasured player and excludes spectators and worlds being recovered', () => {
    const stable = measured(120);
    const bad = measured(500, 300);
    expect(automaticBufferTicks([{ ...stable, linkMeasured: false }], 1)).toBe(2);
    for (const inactive of [
      { ...bad, seat: null },
      { ...bad, connected: false },
      { ...bad, loaded: false },
    ]) {
      expect(automaticBufferTicks([stable, inactive], 1)).toBe(1);
    }
    const recovering = {
      ...bad,
      outOfSync: { kind: 'desync' as const, tick: 1, domains: [], reference: 'B' },
    };
    expect(automaticBufferTicks([stable, recovering], 1)).toBe(1);
  });

  it('raises immediately and lowers at most one tick per ten seconds of continuously calm running', () => {
    const policy = new Responsiveness();
    const calm = [measured(120)];
    expect(policy.message()).toMatchObject({ mode: 'auto', bufferTicks: 2, by: null });
    expect(policy.observe(calm, 1, 0)).toBe(false);
    expect(policy.observe(calm, 1, 9999)).toBe(false);
    expect(policy.observe(calm, 1, 10000)).toBe(true);
    expect(policy.message().bufferTicks).toBe(1);
    expect(policy.observe([measured(100, 100)], 1, 10001)).toBe(true);
    expect(policy.message().bufferTicks).toBe(3);
    policy.observe(calm, 1, 11000);
    expect(policy.observe(calm, 1, 21000)).toBe(true);
    expect(policy.message().bufferTicks).toBe(2);
    policy.observe(calm, 1, 21001);
    expect(policy.observe(calm, 1, 31000)).toBe(false);
    expect(policy.observe(calm, 1, 31001)).toBe(true);
  });

  it('does not count paused or held time as evidence for a smaller buffer', () => {
    const policy = new Responsiveness();
    const members = [measured(40)];
    policy.observe(members, 1, 0);
    policy.observe(members, null, 9000);
    expect(policy.observe(members, 1, 90000)).toBe(false);
    expect(policy.observe(members, 1, 99999)).toBe(false);
    expect(policy.observe(members, 1, 100000)).toBe(true);
  });

  it('keeps manual selections fixed and restarts Auto from its safe reserve', () => {
    const policy = new Responsiveness();
    for (const [mode, bufferTicks] of [
      ['responsive', 1],
      ['balanced', 2],
      ['smooth', 3],
    ] as const) {
      expect(policy.select(mode, 'B')).toBe(true);
      expect(policy.observe([measured(500, 200)], 8, 100000)).toBe(false);
      expect(policy.message()).toMatchObject({ mode, bufferTicks, by: 'B' });
      expect(policy.select(mode, 'A')).toBe(false);
    }
    expect(policy.select('auto', 'A')).toBe(true);
    expect(policy.message()).toMatchObject({ mode: 'auto', bufferTicks: 2, by: 'A' });
  });
});

describe('shared responsiveness selection', () => {
  it('accepts another player, broadcasts once, and preserves the selection across reconnect', () => {
    const s = startedRoom();
    s.b.send({ kind: 'responsiveness', mode: 'smooth' });
    const selected = { kind: 'responsiveness', mode: 'smooth', bufferTicks: 3, by: 'Bartek' };
    expect(s.a.last('responsiveness')).toEqual(selected);
    expect(s.b.last('responsiveness')).toEqual(selected);
    const count = s.a.of('responsiveness').length;
    s.a.send({ kind: 'responsiveness', mode: 'smooth' });
    expect(s.a.of('responsiveness')).toHaveLength(count);
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.last('responsiveness')).toEqual(selected);
    back.send({ kind: 'responsiveness', mode: 'responsive' });
    expect(s.a.last('responsiveness')).toMatchObject({ mode: 'responsive', bufferTicks: 1 });
    expect(back.of('rejected')).toEqual([]);
  });

  it('retains a selection through loading and allows it while paused', () => {
    const s = startingRoom();
    s.b.send({ kind: 'responsiveness', mode: 'responsive' });
    for (const peer of [s.a, s.b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.a.send({ kind: 'clock', paused: true });
    s.advance(500);
    expect(s.a.last('responsiveness')).toMatchObject({ mode: 'responsive', bufferTicks: 1 });
    s.a.send({ kind: 'responsiveness', mode: 'balanced' });
    expect(s.b.last('responsiveness')).toMatchObject({ mode: 'balanced', bufferTicks: 2, by: 'Ania' });
  });

  it('uses valid fresh probes, resets a returning connection, and follows a speed change', () => {
    const s = startedRoom();
    s.advance(1000);
    s.advance(100);
    for (const peer of [s.a, s.b]) peer.send({ kind: 'pong', t: 1000 });
    expect(s.b.handle.member).toMatchObject({ linkMeasured: true, roundTripMs: 100, jitterMs: 0 });
    s.a.send({ kind: 'clock', speed: 8 });
    s.advance(1000);
    s.advance(100);
    s.a.send({ kind: 'pong', t: 2100 });
    s.advance(500);
    s.b.send({ kind: 'pong', t: 2100 });
    s.advance(1);
    expect(s.a.last('responsiveness')).toMatchObject({ mode: 'auto', bufferTicks: 6 });
    expect(s.b.last('responsiveness')).toEqual(s.a.last('responsiveness'));
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.handle.member).toMatchObject({ linkMeasured: false, jitterMs: 0 });
    back.send({ kind: 'pong', t: -1 });
    expect(back.handle.member?.linkMeasured).toBe(false);
  });
});
