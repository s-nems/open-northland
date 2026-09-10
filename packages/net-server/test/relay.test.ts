import {
  MAX_COMMANDS_PER_TICK,
  MAX_ENVELOPE_BYTES,
  PAUSE_BUDGET,
  PROTOCOL_VERSION,
  TICK_MS,
} from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  SEATS,
  SETTINGS,
  seatCommand,
  stage,
  startedRoom,
  TOKEN_A,
  TOKEN_B,
} from './support/message-stage.js';

/**
 * The relay's authority, driven message by message with no sim behind it: who may sit, start, and
 * drive the clock, what an envelope leaves with, and what a returning token gets back.
 */

describe('relay identity', () => {
  it('refuses anything before hello, and a protocol it does not speak', () => {
    const s = stage();
    const early = s.peer();
    early.send({ kind: 'chat', text: 'hej' });
    expect(early.last('error')?.reason).toBe('hello first');
    expect(early.closed()).toBe('hello first');

    const future = s.peer();
    future.send({ kind: 'hello', protocol: PROTOCOL_VERSION + 1, token: TOKEN_A, nick: 'Ania' });
    expect(future.last('error')?.reason).toMatch(/protocol 2 unsupported/);
    expect(s.relay.clientCount).toBe(0);
  });

  it('replaces an older connection of the same token', () => {
    const s = stage();
    const first = s.introduce(TOKEN_A, 'Ania');
    const second = s.introduce(TOKEN_A, 'Ania');
    expect(first.last('error')?.reason).toMatch(/replaced/);
    expect(first.closed()).toBe('replaced');
    expect(second.last('welcome')).toEqual({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
    expect(s.relay.clientCount).toBe(1);
  });

  it('suffixes a duplicate nick within a room', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    expect(b.last('welcome')?.nick).toBe('Ania');
    expect(b.last('room')?.room.members.map((member) => member.nick)).toEqual(['Ania', 'Ania2']);
  });
});

describe('relay rooms', () => {
  it('lists rooms, and drops one when its last member leaves', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    a.send({ kind: 'listRooms' });
    expect(a.last('rooms')?.rooms).toEqual([
      { id: expect.any(String), name: 'Zatoka', state: 'lobby', members: 1, seats: 3 },
    ]);
    a.send({ kind: 'leaveRoom' });
    expect(a.last('left')).toBeDefined();
    expect(s.relay.roomCount).toBe(0);
  });

  it('lets the creator set up vacant seats and refuses a taken one', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    b.send({ kind: 'claimSeat', player: 1 });
    a.send({ kind: 'claimSeat', player: 1 });
    expect(a.last('rejected')?.reason).toMatch(/taken by Bartek/);
    b.send({ kind: 'setSeat', player: 0, mode: 'ai' });
    expect(b.last('rejected')?.reason).toMatch(/only the creator/);
    a.send({ kind: 'setSeat', player: 0, mode: 'ai', color: 5 });
    a.send({ kind: 'setSeat', player: 1, mode: 'ai' });
    expect(a.last('rejected')?.reason).toMatch(/taken by Bartek/);
    expect(a.last('room')?.room.seats).toEqual([
      { player: 0, mode: 'ai', color: 5, nick: null, ready: false },
      { player: 1, mode: 'human', color: 1, nick: 'Bartek', ready: false },
      { player: 2, mode: 'ai', color: 2, nick: null, ready: false },
    ]);
  });

  it('passes the creator role on when the creator leaves the lobby', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    a.send({ kind: 'leaveRoom' });
    expect(b.last('room')?.room.creator).toBe('Bartek');
    b.send({ kind: 'setSeat', player: 0, mode: 'ai' });
    expect(b.of('rejected')).toEqual([]);
    expect(s.relay.roomCount).toBe(1);
  });

  it('refuses leaving a started game, whose seats stay as every client built them', () => {
    const s = startedRoom();
    s.b.send({ kind: 'leaveRoom' });
    expect(s.b.last('rejected')?.reason).toBe('the game has started');
    expect(s.a.last('room')?.room.members).toHaveLength(2);
  });

  it('starts only by the creator, once everyone is seated and ready, with a descriptor per seat', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    a.send({ kind: 'claimSeat', player: 0 });
    a.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(a.last('rejected')?.reason).toBe('Bartek has no seat');
    b.send({ kind: 'claimSeat', player: 1 });
    a.send({ kind: 'start' });
    expect(a.last('rejected')?.reason).toBe('Bartek is not ready');
    b.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'start' });
    expect(b.last('rejected')?.reason).toMatch(/only the creator/);
    a.send({ kind: 'start' });
    const seats = [
      { player: 0, mode: 'human', color: 0 },
      { player: 1, mode: 'human', color: 1 },
      { player: 2, mode: 'ai', color: 2 },
    ];
    expect(a.last('start')).toEqual({
      kind: 'start',
      session: { world: SETTINGS.world, seed: 7, seats, localSeat: 0, rules: SETTINGS.rules, speed: 1 },
      snapshotTick: null,
    });
    expect(b.last('start')?.session).toEqual({
      world: SETTINGS.world,
      seed: 7,
      seats,
      localSeat: 1,
      rules: SETTINGS.rules,
      speed: 1,
    });
    expect(a.last('delay')?.ticks).toBeGreaterThan(0);
    expect(a.last('room')?.room.state).toBe('running');
  });

  it('takes the room away from a connection it replaced', () => {
    const s = startedRoom();
    const newer = s.introduce(TOKEN_B, 'Bartek');
    s.b.send(seatCommand(1));
    expect(s.b.of('error').map((error) => error.reason)).toEqual(['replaced by a newer connection']);
    s.advance(TICK_MS * 3);
    expect(newer.of('frame').flatMap((frame) => frame.commands)).toEqual([]);
    newer.send(seatCommand(1));
    expect(newer.of('rejected')).toEqual([]);
    // Nor can it introduce itself again and take the identity back.
    s.b.send({ kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN_B, nick: 'Bartek' });
    expect(s.b.of('welcome')).toHaveLength(1);
    expect(newer.of('error')).toEqual([]);
    expect(s.relay.clientCount).toBe(2);
  });

  it('gives a returning token its seat and its descriptor back', () => {
    const s = startedRoom();
    s.relay.disconnect(s.a.handle);
    expect(s.b.last('room')?.room.members).toEqual([
      { nick: 'Ania', seat: 0, connected: false },
      { nick: 'Bartek', seat: 1, connected: true },
    ]);
    const back = s.introduce(TOKEN_A, 'Ania');
    expect(back.last('room')?.room.members[0]).toEqual({ nick: 'Ania', seat: 0, connected: true });
    expect(back.last('start')?.session.localSeat).toBe(0);
    expect(back.last('clock')).toEqual({ kind: 'clock', tick: 1, speed: 1, paused: false, by: null });
  });
});

describe('relay clock', () => {
  it('starts the clock once everyone has loaded, then emits empty frames on time', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    a.send({ kind: 'claimSeat', player: 0 });
    a.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    s.advance(TICK_MS * 5);
    expect(a.of('frame')).toEqual([]);
    a.send({ kind: 'loaded', tick: 0, world: 0 });
    expect(a.last('clock')).toEqual({ kind: 'clock', tick: 1, speed: 1, paused: false, by: null });
    s.advance(TICK_MS * 2);
    expect(a.of('frame')).toEqual([
      { kind: 'frame', tick: 1, commands: [] },
      { kind: 'frame', tick: 2, commands: [] },
    ]);
  });

  it('stamps the seat from the connection, whatever the envelope claimed', () => {
    const s = startedRoom();
    s.b.send(seatCommand(0));
    s.advance(TICK_MS * 3);
    const carried = s.a.of('frame').flatMap((frame) => frame.commands);
    expect(carried).toHaveLength(1);
    expect(carried[0]?.envelope).toMatchObject({ origin: 'player', player: 1 });
    expect(s.b.of('rejected')).toEqual([]);
  });

  it('refuses a trusted origin and an oversized envelope by name', () => {
    const s = startedRoom();
    s.b.send({
      kind: 'command',
      envelope: { v: 1, origin: 'admin', command: { kind: 'debugKill' } },
      fromTick: 0,
    });
    expect(s.b.last('rejected')).toEqual({
      kind: 'rejected',
      of: 'command',
      reason: expect.stringMatching(/player envelopes only/),
    });
    s.b.send({
      kind: 'command',
      envelope: {
        v: 1,
        origin: 'player',
        player: 1,
        command: { kind: 'x', pad: 'p'.repeat(MAX_ENVELOPE_BYTES) },
      },
      fromTick: 0,
    });
    expect(s.b.last('rejected')?.reason).toMatch(/over 1024/);
    s.advance(TICK_MS * 3);
    expect(s.a.of('frame').flatMap((frame) => frame.commands)).toEqual([]);
  });

  it('drops the envelope past a member’s budget for one tick and reports it', () => {
    const s = startedRoom();
    for (let i = 0; i <= MAX_COMMANDS_PER_TICK; i++) s.a.send(seatCommand(0, i));
    expect(s.a.of('rejected')).toEqual([
      { kind: 'rejected', of: 'command', reason: expect.stringMatching(/budget/) },
    ]);
    s.advance(TICK_MS * 3);
    expect(s.b.of('frame').flatMap((frame) => frame.commands)).toHaveLength(MAX_COMMANDS_PER_TICK);
  });

  it('lets any member drive the clock, names who did, and refuses a pause past the budget', () => {
    const s = startedRoom();
    s.b.send({ kind: 'clock', speed: 2 });
    expect(s.a.last('clock')).toEqual({ kind: 'clock', tick: 1, speed: 2, paused: false, by: 'Bartek' });
    expect(s.b.last('clock')).toEqual(s.a.last('clock'));
    s.advance(TICK_MS);
    expect(s.a.of('frame').map((frame) => frame.tick)).toEqual([1, 2]);
    for (let n = 0; n < PAUSE_BUDGET; n++) {
      s.a.send({ kind: 'clock', paused: true });
      s.a.send({ kind: 'clock', paused: false });
    }
    s.a.send({ kind: 'clock', paused: true });
    expect(s.a.last('rejected')?.reason).toMatch(/no pauses left/);
    s.b.send({ kind: 'clock', paused: true });
    expect(s.a.last('clock')).toEqual({ kind: 'clock', tick: 3, speed: 2, paused: true, by: 'Bartek' });
    s.advance(TICK_MS * 4);
    expect(s.a.of('frame').map((frame) => frame.tick)).toEqual([1, 2]);
  });

  it('measures the round trip from a pong it sent the ping for, and announces a changed delay', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    s.advance(1000);
    const ping = a.last('ping');
    expect(ping).toBeDefined();
    a.send({ kind: 'pong', t: (ping?.t ?? 0) + 1 });
    expect(a.of('delay')).toEqual([]);
    s.advance(TICK_MS * 4);
    a.send({ kind: 'pong', t: ping?.t });
    expect(a.last('delay')?.ticks).toBe(5);
  });

  it('relays chat to the room with the sender’s nick', () => {
    const s = startedRoom();
    s.a.send({ kind: 'chat', text: 'gotowi?' });
    expect(s.b.last('chat')).toEqual({ kind: 'chat', from: 'Ania', text: 'gotowi?' });
  });
});
