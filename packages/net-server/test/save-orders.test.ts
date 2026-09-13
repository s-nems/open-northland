import { type ServerMessage, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { createMember } from '../src/relay/member.js';
import { Resync } from '../src/relay/resync.js';
import { RoomClock } from '../src/relay/room-clock.js';
import { SaveOrders } from '../src/relay/save-orders.js';
import { ackThrough, seatCommand, startedRoom } from './support/message-stage.js';

const ask = (tick: number, world = 0, id = 1) => ({ kind: 'saveOrders', id, tick, world });
describe('accepted order capture', () => {
  it('correlates parser and dispatch refusals without confusing a later capture', () => {
    const s = startedRoom();
    s.a.send(ask(0, 99, 41));
    const old = s.a.last('rejected');
    expect(old).toMatchObject({ of: 'saveOrders', requestId: 41 });
    s.a.send(ask(0, 0, 42));
    expect(s.a.last('saveOrders')?.id).toBe(42);
    expect(old?.requestId).toBe(41);
    s.a.send({ ...ask(0, 0, 43), tick: -1 });
    expect(s.a.last('rejected')).toMatchObject({ of: 'saveOrders', requestId: 43 });
    s.a.send(ask(0, 0, -1));
    expect(s.a.last('rejected')).not.toHaveProperty('requestId');
  });
  it('captures both paused players once without advancing or consuming the queue', () => {
    const s = startedRoom();
    s.a.send({ kind: 'clock', paused: true });
    s.a.send(seatCommand(0, 11));
    s.b.send(seatCommand(1, 22));
    s.a.send(ask(0));
    const saved = s.a.last('saveOrders');
    expect(saved?.frames).toHaveLength(1);
    expect(saved?.frames[0]?.commands.map((c) => [c.sequence, c.envelope.command])).toMatchObject([
      [0, { value: 11 }],
      [1, { value: 22 }],
    ]);
    const scheduled = saved?.frames[0]?.tick;
    if (scheduled === undefined) throw new Error('no scheduled tick');
    s.b.send(seatCommand(1, 33));
    expect(saved?.frames[0]?.commands).toHaveLength(2);
    s.a.send(ask(0, 0, 2));
    expect(s.a.last('saveOrders')?.frames[0]?.commands).toHaveLength(3);
    expect(s.a.of('frame')).toEqual([]);
    s.a.send({ kind: 'clock', paused: false });
    s.advance(scheduled * TICK_MS);
    expect(s.a.of('frame').find((f) => f.tick === scheduled)?.commands).toHaveLength(3);
  });
  it('includes emitted but unapplied orders followed by still pending orders', () => {
    const s = startedRoom();
    s.a.send(seatCommand(0, 11));
    s.a.send(ask(0));
    const tick = s.a.last('saveOrders')?.frames[0]?.tick;
    if (tick === undefined) throw new Error('missing frame');
    s.advance(tick * TICK_MS);
    s.b.send(seatCommand(1, 22));
    s.a.send(ask(0));
    const frames = s.a.last('saveOrders')?.frames;
    expect(frames?.map((f) => f.tick)).toEqual([tick, tick + 1]);
    expect(frames?.map((f) => f.commands[0]?.envelope.command)).toMatchObject([{ value: 11 }, { value: 22 }]);
  });
  it('rejects stale generations, unacknowledged snapshots, disconnected members and missing replay', () => {
    const s = startedRoom();
    s.a.send(ask(0, 99));
    expect(s.a.last('rejected')?.reason).toMatch(/generation/);
    s.a.send(ask(1));
    expect(s.a.last('rejected')?.reason).toMatch(/acknowledged/);
    s.advance(TICK_MS * 4);
    ackThrough(s.a, 1, 4);
    ackThrough(s.b, 1, 4);
    s.a.send({ kind: 'blob', type: 'snapshot', tick: 3, to: null, bytes: 'AAAA' });
    s.a.send(ask(1));
    expect(s.a.last('rejected')?.reason).toMatch(/no longer retained/);
    const member = createMember('token', 'Nick', 0, { delayTicks: 1, roundTripMs: 0 });
    member.loaded = true;
    member.connected = false;
    const clock = new RoomClock(1);
    const capture = new SaveOrders(
      clock,
      new Resync(new Map(), () => {}, 0),
      () => 0,
      () => {
        throw new Error('must not deliver');
      },
    );
    expect(capture.capture(member, { kind: 'saveOrders', id: 1, tick: 0, world: 0 })).toMatch(/connected/);
  });
  it('refuses an oversized capture atomically instead of returning a truncated order list', () => {
    const member = createMember('token', 'Nick', 0, { delayTicks: 1, roundTripMs: 0 });
    member.loaded = true;
    const clock = new RoomClock(1);
    clock.startAt(6000);
    const sent: ServerMessage[] = [];
    const history = new Resync(new Map([['token', member]]), (_m, message) => sent.push(message), 0);
    const envelope = {
      v: 1,
      origin: 'player' as const,
      player: 0,
      command: { kind: 'opaque', padding: 'x'.repeat(900) },
    };
    for (let tick = 1; tick <= 6000; tick++)
      expect(history.record({ tick, commands: [{ sequence: 0, envelope }] }, 0)).toBe(true);
    const capture = new SaveOrders(
      clock,
      history,
      () => 0,
      (_m, message) => sent.push(message),
    );
    expect(capture.capture(member, { kind: 'saveOrders', id: 1, tick: 0, world: 0 })).toMatch(/byte budget/);
    expect(sent).toEqual([]);
  });
});
