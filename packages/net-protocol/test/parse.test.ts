import type { GameSession } from '@open-northland/lockstep';
import { describe, expect, it } from 'vitest';
import {
  type ClientMessage,
  clientMessageKind,
  MAX_NICK_LENGTH,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  type RoomSettings,
  type ServerMessage,
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
  { kind: 'loaded' },
  {
    kind: 'command',
    envelope: { v: 1, origin: 'player', player: 0, command: MOVE_ORDER },
    fromTick: 12,
  },
  { kind: 'clock', speed: 2 },
  { kind: 'clock', paused: true },
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
  { kind: 'start', session },
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
  { kind: 'chat', from: 'Ania', text: 'gotowi?' },
  { kind: 'ping', t: 99 },
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

  it('hands the session to the parser it was given', () => {
    const refusing = (): GameSession => {
      throw new Error('session: not for this client');
    };
    expect(() => parseServerMessage(wire({ kind: 'start', session }), refusing)).toThrow(
      /not for this client/,
    );
  });
});
