import { parseGameSession } from '@open-northland/lockstep';
import {
  MAX_CHAT_HISTORY_LINES,
  MAX_COMMANDS_PER_TICK,
  MAX_ENVELOPE_BYTES,
  MAX_NICK_LENGTH,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
  TICK_MS,
} from '@open-northland/net-protocol';
import { HELLO_TIMEOUT_MS, KICK_COUNTDOWN_MS, Relay } from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';
import {
  type Peer,
  SEATS,
  SETTINGS,
  STAGE_EPOCH_MS,
  seatCommand,
  stage,
  startedRoom,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
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
    expect(early.last('error')?.reason).toEqual({ code: 'helloFirst' });
    expect(early.closed()).toBe('helloFirst');

    const future = s.peer();
    future.send({ kind: 'hello', protocol: PROTOCOL_VERSION + 1, token: TOKEN_A, nick: 'Ania' });
    expect(future.last('error')?.reason).toEqual({
      code: 'protocolUnsupported',
      client: PROTOCOL_VERSION + 1,
      relay: PROTOCOL_VERSION,
    });
    expect(s.relay.clientCount).toBe(0);
  });

  it('closes a connection that never introduces itself', () => {
    const s = stage();
    const idle = s.peer();
    s.advance(HELLO_TIMEOUT_MS - 1);
    expect(idle.closed()).toBeNull();
    s.advance(1);
    expect(idle.closed()).toBe('helloOverdue');
    expect(s.relay.clientCount).toBe(0);
    const introduced = s.introduce(TOKEN_A, 'Ania');
    s.advance(HELLO_TIMEOUT_MS * 2);
    expect(introduced.closed()).toBeNull();
  });

  it('replaces an older connection of the same token', () => {
    const s = stage();
    const first = s.introduce(TOKEN_A, 'Ania');
    const second = s.introduce(TOKEN_A, 'Ania');
    expect(first.last('error')?.reason).toEqual({ code: 'replaced' });
    expect(first.closed()).toBe('replaced');
    expect(second.last('welcome')).toEqual({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
    expect(s.relay.clientCount).toBe(1);
  });

  it('names its build in the welcome when it was given one, and refuses one no client would parse', () => {
    const sent: ServerMessage[] = [];
    const relay = new Relay({ build: 'relay-1' });
    const handle = relay.connect({ send: (message) => sent.push(message), close: () => undefined });
    relay.receive(handle, { kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN_A, nick: 'Ania' });
    expect(sent).toContainEqual({
      kind: 'welcome',
      protocol: PROTOCOL_VERSION,
      nick: 'Ania',
      build: 'relay-1',
    });
    expect(() => new Relay({ build: 'two\nlines' })).toThrow(/build/);
  });

  it('suffixes a duplicate nick within a room', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    expect(b.last('welcome')?.nick).toBe('Ania2');
    expect(b.last('room')?.room.members.map((member) => member.nick)).toEqual(['Ania', 'Ania2']);
  });

  it('suffixes a full-length nick of astral characters without cutting a surrogate pair', () => {
    const nick = '😀'.repeat(MAX_NICK_LENGTH / 2);
    const s = stage();
    const a = s.introduce(TOKEN_A, nick);
    const b = s.introduce(TOKEN_B, nick);
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    const suffixed = b.last('welcome')?.nick;
    expect(suffixed).toBe(`${'😀'.repeat(MAX_NICK_LENGTH / 2 - 1)}2`);
    expect(() => parseServerMessage(b.last('room'), parseGameSession)).not.toThrow();
  });
});

describe('relay rooms', () => {
  it('leaves a departed human idle even when their seat only offered AI in the lobby', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({
      kind: 'createRoom',
      settings: { ...SETTINGS, kickedSeatMode: 'idle' },
      seats: SEATS.map((seat) => (seat.player === 2 ? { ...seat, offers: ['ai'] } : seat)),
    });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 2 });
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    a.send({ kind: 'loaded', tick: 0, world: 0 });
    b.send({ kind: 'loaded', tick: 0, world: 0 });
    b.send({ kind: 'leaveRoom' });
    expect(a.last('kicked')).toMatchObject({ player: 2, mode: 'idle', cause: 'left' });
    expect(a.last('room')?.room.seats[2]).toMatchObject({ mode: 'idle', nick: null });
    expect(() => parseServerMessage(a.last('room'), parseGameSession)).not.toThrow();
    s.advance(TICK_MS);
    expect(a.of('frame').flatMap((frame) => frame.commands)).toEqual([]);
  });
  it('defers departure handover until the first built world establishes its baseline', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania'),
      b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: { ...SETTINGS, kickedSeatMode: 'ai' }, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    // Voted out while nobody has loaded: the seat changes hands only once a world fixes the tick.
    s.advance(TICK_MS);
    s.advance(KICK_COUNTDOWN_MS);
    a.send({ kind: 'kick', player: 1, yes: true });
    expect(a.of('rejected')).toEqual([]);
    expect(a.of('kicked')).toEqual([]);
    const ping = a.last('ping');
    if (ping !== undefined) a.send({ kind: 'pong', t: ping.t });
    a.send({ kind: 'loaded', tick: 1, world: 0 });
    expect(a.last('kicked')).toMatchObject({ player: 1, tick: 2, mode: 'ai' });
    s.advance(TICK_MS);
    expect(a.last('frame')).toMatchObject({
      tick: 2,
      commands: [{ envelope: { command: { kind: 'setPlayerAi', player: 1 } } }],
    });
  });

  it('frees identity and the final room slot before a left callback creates the next room', () => {
    const relay = new Relay({ now: () => 0, maxRooms: 1 });
    const sent: unknown[] = [];
    let replacement = false;
    const client = relay.connect({
      send: (message) => {
        sent.push(message);
        if (message.kind === 'left' && !replacement) {
          replacement = true;
          relay.receive(client, { kind: 'createRoom', settings: SETTINGS, seats: SEATS });
        }
      },
      close: () => undefined,
    });
    relay.receive(client, { kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN_A, nick: 'Ania' });
    relay.receive(client, { kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const before = client.room;
    relay.receive(client, { kind: 'leaveRoom' });
    expect(client.room).not.toBe(before);
    expect(client.room).not.toBeNull();
    expect(relay.roomCount).toBe(1);
    expect(sent).not.toContainEqual(expect.objectContaining({ kind: 'rejected' }));
  });

  it('ends the one room whose clock faults and keeps running the others', () => {
    const s = stage();
    const soloRoom = (token: string, nick: string) => {
      const peer = s.introduce(token, nick);
      peer.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
      peer.send({ kind: 'claimSeat', player: 0 });
      peer.send({ kind: 'setReady', ready: true });
      peer.send({ kind: 'start' });
      peer.send({ kind: 'loaded', tick: 0, world: 0 });
      return peer;
    };
    const faulty = soloRoom(TOKEN_A, 'Ania');
    const healthy = soloRoom(TOKEN_B, 'Bartek');
    const room = faulty.handle.room;
    if (room === null) throw new Error('no room');
    room.advance = () => {
      throw new Error('broken room state');
    };
    s.advance(TICK_MS);
    s.advance(TICK_MS);
    expect(faulty.last('error')?.reason).toEqual({ code: 'relayFault' });
    expect(faulty.last('left')).toBeDefined();
    expect(s.relay.roomCount).toBe(1);
    expect(healthy.of('frame').map((frame) => frame.tick)).toEqual([1, 2]);
  });

  it('holds as many rooms as it was configured for', () => {
    const time = { ms: 0 };
    const relay = new Relay({ now: () => time.ms, maxRooms: 1 });
    const sent: unknown[] = [];
    const client = relay.connect({ send: (message) => sent.push(message), close: () => undefined });
    relay.receive(client, { kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN_A, nick: 'Ania' });
    relay.receive(client, { kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    relay.receive(client, { kind: 'leaveRoom' });
    relay.receive(client, { kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    expect(relay.roomCount).toBe(1);
    const other = relay.connect({ send: (message) => sent.push(message), close: () => undefined });
    relay.receive(other, { kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN_B, nick: 'Bartek' });
    relay.receive(other, { kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    expect(sent.at(-1)).toEqual({
      kind: 'rejected',
      of: 'createRoom',
      reason: { code: 'relayFull', rooms: 1 },
    });
  });

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
    expect(a.last('rejected')?.reason).toMatchObject({ code: 'seatTaken', nick: 'Bartek' });
    b.send({ kind: 'setSeat', player: 0, mode: 'ai' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    a.send({ kind: 'setSeat', player: 0, mode: 'ai', color: 5 });
    a.send({ kind: 'setSeat', player: 1, mode: 'ai' });
    expect(a.last('rejected')?.reason).toMatchObject({ code: 'seatTaken', nick: 'Bartek' });
    expect(a.last('room')?.room.seats).toEqual([
      { player: 0, mode: 'ai', offers: ['idle', 'ai', 'absent'], color: 5, nick: null, ready: false },
      { player: 1, mode: 'human', offers: ['idle', 'ai', 'absent'], color: 1, nick: 'Bartek', ready: false },
      { player: 2, mode: 'ai', offers: ['idle', 'ai', 'absent'], color: 2, nick: null, ready: false },
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

  it('starts an absent seat as absent and hands a departed occupant of one to idle', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    a.send({ kind: 'setSeat', player: 1, mode: 'absent' });
    a.send({ kind: 'setSeat', player: 2, mode: 'absent' });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    const started = a.last('start');
    if (started === undefined) throw new Error('expected a start');
    expect(parseGameSession(started.session).seats.map((seat) => seat.mode)).toEqual([
      'human',
      'human',
      'absent',
    ]);
    a.send({ kind: 'loaded', tick: 0, world: 0 });
    b.send({ kind: 'loaded', tick: 0, world: 0 });
    b.send({ kind: 'leaveRoom' });
    expect(a.last('kicked')).toMatchObject({ player: 1, mode: 'idle' });
    expect(a.last('room')?.room.seats[1]?.mode).toBe('idle');
  });

  it('offers each seat only the vacant modes its map allows, a departure included', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({
      kind: 'createRoom',
      settings: { ...SETTINGS, kickedSeatMode: 'ai' },
      seats: [
        { player: 0, mode: 'idle', offers: ['idle', 'ai', 'absent'], color: 0 },
        { player: 1, mode: 'idle', offers: ['idle'], color: 1 },
      ],
    });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    a.send({ kind: 'setSeat', player: 1, mode: 'absent' });
    expect(a.last('rejected')?.reason).toMatchObject({ code: 'seatModeUnavailable', mode: 'absent' });
    a.send({ kind: 'setSeat', player: 1, mode: 'ai' });
    expect(a.last('rejected')?.reason).toMatchObject({ code: 'seatModeUnavailable', mode: 'ai' });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    a.send({ kind: 'loaded', tick: 0, world: 0 });
    b.send({ kind: 'loaded', tick: 0, world: 0 });
    b.send({ kind: 'leaveRoom' });
    // The room hands a departed seat to the AI, but this map allows none there.
    expect(a.last('kicked')).toMatchObject({ player: 1, mode: 'idle' });
  });

  it('releases an explicit departure while the other running member continues', () => {
    const s = startedRoom();
    s.b.send({ kind: 'leaveRoom' });
    expect(s.b.last('left')).toEqual({ kind: 'left' });
    expect(s.b.handle.room).toBeNull();
    expect(s.a.last('room')?.room.members).toHaveLength(1);
    expect(s.a.last('kicked')).toMatchObject({ player: 1, mode: 'idle', tick: 1 });
    s.b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    expect(s.b.last('room')?.room.id).not.toBe(s.roomId);
    expect(s.relay.roomCount).toBe(2);
    s.advance(TICK_MS);
    expect(s.a.last('frame')?.tick).toBe(1);
    s.a.send({ kind: 'leaveRoom' });
    expect(s.relay.roomCount).toBe(1);
    s.b.send({ kind: 'leaveRoom' });
    expect(s.relay.roomCount).toBe(0);
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
    expect(a.last('rejected')?.reason).toEqual({ code: 'memberUnseated', nick: 'Bartek' });
    b.send({ kind: 'claimSeat', player: 1 });
    a.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(a.last('rejected')?.reason).toEqual({ code: 'memberNotReady', nick: 'Bartek' });
    b.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'start' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
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
    expect(s.b.of('error').map((error) => error.reason)).toEqual([{ code: 'replaced' }]);
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
    expect(s.b.last('room')?.room.members).toMatchObject([
      { nick: 'Ania', seat: 0, connected: false },
      { nick: 'Bartek', seat: 1, connected: true },
    ]);
    const back = s.introduce(TOKEN_A, 'Ania');
    expect(back.last('room')?.room.members[0]).toMatchObject({ nick: 'Ania', seat: 0, connected: true });
    expect(back.last('start')?.session.localSeat).toBe(0);
    expect(back.last('clock')).toEqual({
      kind: 'clock',
      tick: 1,
      speed: 1,
      paused: false,
      by: null,
      governed: null,
    });
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
    expect(a.last('clock')).toEqual({
      kind: 'clock',
      tick: 1,
      speed: 1,
      paused: false,
      by: null,
      governed: null,
    });
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
      reason: { code: 'malformed', detail: expect.stringMatching(/player envelopes only/) },
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
    expect(s.b.last('rejected')?.reason).toEqual({ code: 'envelopeTooLarge' });
    s.advance(TICK_MS * 3);
    expect(s.a.of('frame').flatMap((frame) => frame.commands)).toEqual([]);
  });

  it('refuses excess gestures without silently deferring them', () => {
    const s = startedRoom();
    for (let i = 0; i <= MAX_COMMANDS_PER_TICK; i++) s.a.send(seatCommand(0, i));
    expect(s.a.of('rejected')).toEqual([
      { kind: 'rejected', of: 'command', reason: { code: 'commandBudget' } },
    ]);
    s.advance(TICK_MS * 10);
    expect(s.b.of('frame').flatMap((frame) => frame.commands)).toHaveLength(MAX_COMMANDS_PER_TICK);
    for (const frame of s.b.of('frame'))
      expect(frame.commands.length).toBeLessThanOrEqual(MAX_COMMANDS_PER_TICK);
  });

  it('lets any member drive the clock as often as they like and names who did', () => {
    const s = startedRoom();
    s.b.send({ kind: 'clock', speed: 2 });
    expect(s.a.last('clock')).toEqual({
      kind: 'clock',
      tick: 1,
      speed: 2,
      paused: false,
      by: 'Bartek',
      governed: null,
    });
    expect(s.b.last('clock')).toEqual(s.a.last('clock'));
    s.advance(TICK_MS);
    expect(s.a.of('frame').map((frame) => frame.tick)).toEqual([1, 2]);
    const pauseCycles = 10;
    for (let n = 0; n < pauseCycles; n++) {
      s.a.send({ kind: 'clock', paused: true });
      s.a.send({ kind: 'clock', paused: false });
    }
    expect(s.a.of('rejected')).toEqual([]);
    s.b.send({ kind: 'clock', paused: true });
    expect(s.a.last('clock')).toEqual({
      kind: 'clock',
      tick: 3,
      speed: 2,
      paused: true,
      by: 'Bartek',
      governed: null,
    });
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

  it('relays chat to the room with the sender’s nick and the relay’s wall clock', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 3);
    s.a.send({ kind: 'chat', text: 'gotowi?' });
    const at = STAGE_EPOCH_MS + s.now();
    expect(s.b.last('chat')).toEqual({ kind: 'chat', from: 'Ania', text: 'gotowi?', at });
  });
});

describe('chat history', () => {
  /** The kinds a peer received from `index` on, in order. */
  const kindsFrom = (peer: Peer, index: number) => peer.sent.slice(index).map((message) => message.kind);

  it('replays the room’s chat, lobby lines first, right after the room view on join and on return', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    expect(a.last('chatHistory')).toEqual({ kind: 'chatHistory', lines: [] });
    a.send({ kind: 'chat', text: 'kto gra?' });
    const lobbyLine = { from: 'Ania', text: 'kto gra?', at: STAGE_EPOCH_MS + s.now() };

    const b = s.introduce(TOKEN_B, 'Bartek');
    const joinedAt = b.sent.length;
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id ?? '' });
    // The stage's own compatibility report follows with another view.
    expect(kindsFrom(b, joinedAt).slice(0, 2)).toEqual(['room', 'chatHistory']);
    expect(b.last('chatHistory')?.lines).toEqual([lobbyLine]);

    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    a.send({ kind: 'loaded', tick: 0, world: 0 });
    b.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(TICK_MS * 2);
    b.send({ kind: 'chat', text: 'atak' });
    const gameLine = { from: 'Bartek', text: 'atak', at: STAGE_EPOCH_MS + s.now() };

    s.relay.disconnect(b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(kindsFrom(back, 0)).toEqual([
      'welcome',
      'room',
      'chatHistory',
      'responsiveness',
      'start',
      'clock',
    ]);
    expect(back.last('chatHistory')?.lines).toEqual([lobbyLine, gameLine]);
  });

  it('keeps each room’s lines to that room', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const b = s.introduce(TOKEN_B, 'Bartek');
    b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    a.send({ kind: 'chat', text: 'tu Ania' });
    b.send({ kind: 'chat', text: 'tu Bartek' });
    expect(a.of('chat').map((line) => line.from)).toEqual(['Ania']);
    expect(b.of('chat').map((line) => line.from)).toEqual(['Bartek']);

    const c = s.introduce(TOKEN_C, 'Cezary');
    c.send({ kind: 'joinRoom', roomId: b.last('room')?.room.id ?? '' });
    expect(c.last('chatHistory')?.lines).toEqual([{ from: 'Bartek', text: 'tu Bartek', at: STAGE_EPOCH_MS }]);
  });

  it('keeps the newest lines up to its cap', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    for (let line = 0; line <= MAX_CHAT_HISTORY_LINES; line++) a.send({ kind: 'chat', text: String(line) });
    const b = s.introduce(TOKEN_B, 'Bartek');
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id ?? '' });
    const lines = b.last('chatHistory')?.lines ?? [];
    expect(lines).toHaveLength(MAX_CHAT_HISTORY_LINES);
    expect(lines[0]?.text).toBe('1');
    expect(lines.at(-1)?.text).toBe(String(MAX_CHAT_HISTORY_LINES));
  });
});
