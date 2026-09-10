import type { GameSession } from '@open-northland/lockstep';
import { describe, expect, it } from 'vitest';
import {
  type ClientMessage,
  clientMessageKind,
  MAX_BLOB_BYTES,
  MAX_NICK_LENGTH,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  type RoomSettings,
  type ServerMessage,
  type WireDigest,
} from '../src/index.js';

/**
 * Both parsers face another machine: everything they accept must survive a JSON round trip unchanged,
 * and everything that would let one client's input differ from another's must be refused by name.
 */

const TOKEN = 'abcdefghijklmnop0123';

const settings: RoomSettings = {
  name: 'Zatoka o świcie',
  world: { kind: 'map', mapId: 'zatoka' },
  seed: 7,
  rules: { fog: 1, progression: null, needs: false },
  speed: 1,
};

const session: GameSession = {
  world: settings.world,
  seed: settings.seed,
  seats: [{ player: 0, mode: 'human', color: 0 }],
  localSeat: 0,
  rules: settings.rules,
  speed: 1,
};

/** Payloads stay opaque to the wire, so they are plain records here, not sim command types. */
const MOVE_ORDER: { readonly kind: string } & Record<string, unknown> = {
  kind: 'moveUnit',
  entity: 4,
  x: 1,
  y: 2,
};
const STANCE_ORDER: { readonly kind: string } & Record<string, unknown> = { kind: 'setStance', entity: 4 };
const DIGEST: WireDigest = {
  rng: 1,
  entities: 2,
  players: 3,
  movement: 4,
  settlers: 5,
  economy: 6,
  combat: 7,
  fog: 0xffffffff,
};
const BLOB = Buffer.from('a snapshot').toString('base64');

function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

const CLIENT_MESSAGES: readonly ClientMessage[] = [
  { kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN, nick: 'Ania' },
  { kind: 'listRooms' },
  {
    kind: 'createRoom',
    settings,
    seats: [
      { player: 0, mode: 'idle', color: 0 },
      { player: 3, mode: 'ai', color: 9 },
    ],
  },
  { kind: 'joinRoom', roomId: 'a1b2c3d4' },
  { kind: 'leaveRoom' },
  { kind: 'claimSeat', player: 2 },
  { kind: 'claimSeat', player: null },
  { kind: 'setSeat', player: 1, mode: 'ai', color: 4 },
  { kind: 'setSeat', player: 1 },
  { kind: 'setReady', ready: true },
  { kind: 'start' },
  { kind: 'loaded', tick: 1, world: 0 },
  { kind: 'loaded', tick: 300, world: 240 },
  { kind: 'loaded', tick: null },
  { kind: 'ack', tick: 12, digest: DIGEST, world: 0 },
  {
    kind: 'command',
    envelope: { v: 1, origin: 'player', player: 0, command: MOVE_ORDER },
    fromTick: 12,
  },
  { kind: 'clock', speed: 2 },
  { kind: 'clock', paused: true },
  { kind: 'kick', player: 1 },
  { kind: 'blob', type: 'snapshot', to: null, tick: 40, bytes: BLOB },
  { kind: 'blob', type: 'save', to: 'Ania', tick: 40, bytes: BLOB },
  { kind: 'blob', type: 'map', to: null, tick: null, bytes: BLOB },
  { kind: 'chat', text: 'gotowi?' },
  { kind: 'pong', t: 1234.5 },
];

describe('client messages', () => {
  for (const message of CLIENT_MESSAGES) {
    it(`round-trips ${message.kind}`, () => {
      expect(parseClientMessage(wire(message))).toEqual(message);
    });
  }

  it.each<[string, unknown, RegExp]>([
    ['an unknown kind', { kind: 'teleport' }, /message\.kind/],
    ['a short token', { kind: 'hello', protocol: 1, token: 'short', nick: 'A' }, /hello\.token/],
    [
      'a nick with a newline',
      { kind: 'hello', protocol: 1, token: TOKEN, nick: 'A\nB' },
      /control character/,
    ],
    [
      'a nick past the cap',
      { kind: 'hello', protocol: 1, token: TOKEN, nick: 'x'.repeat(MAX_NICK_LENGTH + 1) },
      /longer/,
    ],
    [
      'seats out of ascending order',
      {
        kind: 'createRoom',
        settings,
        seats: [
          { player: 2, mode: 'ai', color: 0 },
          { player: 1, mode: 'ai', color: 0 },
        ],
      },
      /ascending/,
    ],
    [
      'a seat past the last one',
      { kind: 'createRoom', settings, seats: [{ player: 16, mode: 'ai', color: 0 }] },
      /past the last seat/,
    ],
    [
      'a human seat setup',
      { kind: 'createRoom', settings, seats: [{ player: 0, mode: 'human', color: 0 }] },
      /one of ai, idle/,
    ],
    [
      'a trusted envelope',
      {
        kind: 'command',
        envelope: { v: 1, origin: 'admin', command: { kind: 'debugKill', entity: 1 } },
        fromTick: 0,
      },
      /player envelopes only/,
    ],
    [
      'an envelope without a command kind',
      { kind: 'command', envelope: { v: 1, origin: 'player', player: 0, command: {} }, fromTick: 0 },
      /command\.kind/,
    ],
    ['a clock change naming nothing', { kind: 'clock' }, /neither/],
    ['a zero speed', { kind: 'clock', speed: 0 }, /clock\.speed/],
    ['a negative pong', { kind: 'pong', t: -1 }, /pong\.t/],
    ['an empty chat line', { kind: 'chat', text: '   ' }, /empty/],
    [
      'a digest missing a domain',
      { kind: 'ack', tick: 1, digest: { ...DIGEST, fog: undefined }, world: 0 },
      /digest\.fog/,
    ],
    [
      'a digest with a stray domain',
      { kind: 'ack', tick: 1, digest: { ...DIGEST, magic: 1 }, world: 0 },
      /unknown domain/,
    ],
    [
      'a digest word past 32 bits',
      { kind: 'ack', tick: 1, digest: { ...DIGEST, rng: 2 ** 32 }, world: 0 },
      /32-bit/,
    ],
    [
      'a save without a tick',
      { kind: 'blob', type: 'save', to: null, tick: null, bytes: BLOB },
      /blob\.tick/,
    ],
    [
      'a blob that is not base64',
      { kind: 'blob', type: 'map', to: null, tick: null, bytes: 'a b' },
      /base64/,
    ],
    [
      'a blob over the cap',
      {
        kind: 'blob',
        type: 'map',
        to: null,
        tick: null,
        bytes: 'A'.repeat(Math.ceil(MAX_BLOB_BYTES / 3) * 4 + 4),
      },
      /over/,
    ],
  ])('refuses %s', (_name, value, reason) => {
    expect(() => parseClientMessage(value)).toThrow(reason);
  });

  it('names the kind of a message it refuses, when it claims one', () => {
    expect(clientMessageKind({ kind: 'chat', text: '' })).toBe('chat');
    expect(clientMessageKind({ kind: 'teleport' })).toBeNull();
    expect(clientMessageKind('chat')).toBeNull();
  });
});

const SERVER_MESSAGES: readonly ServerMessage[] = [
  { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania2' },
  { kind: 'rooms', rooms: [{ id: 'a1b2c3d4', name: settings.name, state: 'lobby', members: 1, seats: 4 }] },
  {
    kind: 'room',
    room: {
      id: 'a1b2c3d4',
      state: 'lobby',
      creator: 'Ania',
      settings,
      seats: [
        { player: 0, mode: 'human', color: 0, nick: 'Ania', ready: true },
        { player: 1, mode: 'ai', color: 4, nick: null, ready: false },
      ],
      members: [
        { nick: 'Ania', seat: 0, connected: true },
        { nick: 'Bartek', seat: null, connected: false },
      ],
    },
  },
  { kind: 'left' },
  { kind: 'start', session, snapshotTick: null },
  { kind: 'start', session, snapshotTick: 300 },
  { kind: 'clock', tick: 40, speed: 2, paused: false, by: 'Ania' },
  { kind: 'clock', tick: 1, speed: 1, paused: false, by: null },
  {
    kind: 'frame',
    tick: 41,
    commands: [
      { envelope: { v: 1, origin: 'player', player: 0, command: STANCE_ORDER }, sequence: 0 },
      { envelope: { v: 1, origin: 'player', player: 1, command: STANCE_ORDER }, sequence: 1 },
    ],
  },
  { kind: 'delay', ticks: 3 },
  {
    kind: 'waiting',
    for: [
      { nick: 'Ania', reason: 'gone', voteAfterMs: 60000 },
      { nick: 'Cezary', reason: 'lagging', voteAfterMs: 0 },
    ],
  },
  { kind: 'waiting', for: [] },
  { kind: 'kickVote', player: 0, nick: 'Ania', yes: ['Bartek'], needed: 2 },
  { kind: 'kicked', player: 0, nick: 'Ania', mode: 'ai', tick: 42 },
  { kind: 'desync', tick: 41, domains: ['rng', 'economy'], reference: 'Ania' },
  { kind: 'snapshotRequest' },
  { kind: 'blob', type: 'snapshot', from: 'Ania', tick: 40, bytes: BLOB },
  {
    kind: 'frame',
    tick: 42,
    commands: [
      {
        envelope: { v: 1, origin: 'admin', command: { kind: 'setPlayerAi', player: 0, enabled: true } },
        sequence: 0,
      },
    ],
  },
  { kind: 'chat', from: 'Ania', text: 'gotowi?' },
  { kind: 'ping', t: 99, roundTripMs: 42.5 },
  { kind: 'rejected', of: 'command', reason: 'no seat' },
  { kind: 'error', reason: 'hello first' },
];

describe('server messages', () => {
  const parseSession = (value: unknown): GameSession => {
    expect(value).toEqual(wire(session));
    return session;
  };

  for (const message of SERVER_MESSAGES) {
    it(`round-trips ${message.kind}`, () => {
      expect(parseServerMessage(wire(message), parseSession)).toEqual(message);
    });
  }

  it('refuses a frame whose sequences are not its positions', () => {
    const frame = {
      kind: 'frame',
      tick: 1,
      commands: [{ envelope: { v: 1, origin: 'player', player: 0, command: { kind: 'x' } }, sequence: 1 }],
    };
    expect(() => parseServerMessage(frame, parseSession)).toThrow(/sequence 1 out of order/);
  });

  it('refuses a trusted envelope in a frame other than the relay’s one allowed command', () => {
    const frame = (command: Record<string, unknown>) => ({
      kind: 'frame',
      tick: 1,
      commands: [{ envelope: { v: 1, origin: 'admin', command }, sequence: 0 }],
    });
    expect(() => parseServerMessage(frame({ kind: 'debugKill', entity: 1 }), parseSession)).toThrow(
      /setPlayerAi only/,
    );
    expect(() =>
      parseServerMessage(frame({ kind: 'setPlayerAi', player: 0, enabled: false }), parseSession),
    ).toThrow(/enabled/);
    expect(() =>
      parseServerMessage(
        {
          kind: 'frame',
          tick: 1,
          commands: [{ envelope: { v: 1, origin: 'setup', command: {} }, sequence: 0 }],
        },
        parseSession,
      ),
    ).toThrow(/player envelopes only/);
  });

  it('refuses a wait reason and a desync domain it does not know', () => {
    expect(() =>
      parseServerMessage(
        { kind: 'waiting', for: [{ nick: 'A', reason: 'bored', voteAfterMs: 0 }] },
        parseSession,
      ),
    ).toThrow(/reason/);
    expect(() =>
      parseServerMessage({ kind: 'desync', tick: 1, domains: ['weather'], reference: 'A' }, parseSession),
    ).toThrow(/domains\[0\]/);
  });

  it('hands the session to the parser it was given', () => {
    const refusing = (): GameSession => {
      throw new Error('session: not for this client');
    };
    expect(() => parseServerMessage(wire({ kind: 'start', session, snapshotTick: null }), refusing)).toThrow(
      /not for this client/,
    );
  });
});
