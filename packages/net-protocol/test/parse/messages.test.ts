import type { GameSession } from '@open-northland/lockstep';
import { describe, expect, it } from 'vitest';
import {
  type ClientMessage,
  clientMessageKind,
  closingCode,
  MAX_BLOB_BYTES,
  MAX_CHAT_HISTORY_LINES,
  MAX_HALL_CHAT_LINES,
  MAX_LOADING_PROGRESS,
  MAX_NICK_LENGTH,
  MAX_PRESENCE_ENTRIES,
  MAX_REPORTED_BUFFERED,
  MAX_REPORTED_TICK_MS,
  MAX_TRIBE_ID,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  type RoomSettings,
  type ServerMessage,
  type WireDigest,
} from '../../src/index.js';

/**
 * Both parsers face another machine: everything they accept must survive a JSON round trip unchanged,
 * and everything that would let one client's input differ from another's must be refused by name.
 */

const TOKEN = 'abcdefghijklmnop0123';
const COMPATIBILITY = {
  content: 'a'.repeat(64),
  map: 'b'.repeat(64),
  client: 'fixture',
  protocol: PROTOCOL_VERSION,
};

const settings: RoomSettings = {
  name: 'Zatoka o świcie',
  world: { kind: 'map', mapId: 'zatoka' },
  seed: 7,
  rules: {
    fog: 1,
    progression: null,
    needs: false,
    weather: 'winter',
    dayNight: null,
    alliedVision: null,
    peace: null,
  },
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
const LOAD = { tickMs: 1, buffered: 0 };
const BLOB = Buffer.from('a snapshot').toString('base64');

function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

const CLIENT_MESSAGES: readonly ClientMessage[] = [
  { kind: 'finish', tick: 12, hash: '0123abcd', world: 0 },
  { kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN, nick: 'Ania' },
  { kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN, nick: 'Ania', flag: 'PL' },
  { kind: 'listRooms' },
  {
    kind: 'createRoom',
    settings,
    seats: [
      { player: 0, mode: 'idle', claimable: true, offers: ['idle', 'computer', 'absent'], color: 0 },
      { player: 3, mode: 'map-ai', claimable: false, offers: ['map-ai'], color: 9 },
    ],
  },
  {
    kind: 'createRoom',
    settings,
    seats: [
      { player: 0, mode: 'idle', claimable: true, offers: ['idle', 'computer'], color: 0, authoredTribe: 1 },
      {
        player: 1,
        mode: 'computer',
        claimable: true,
        offers: ['idle', 'computer'],
        color: 1,
        authoredTribe: 2,
        tribe: 7,
      },
    ],
  },
  {
    kind: 'createRoom',
    settings: { ...settings, world: { kind: 'map', mapId: 'specjalna_forteca', variant: 'ragnarok' } },
    seats: [{ player: 4, mode: 'computer', claimable: true, offers: ['computer', 'idle'], color: 7 }],
  },
  { kind: 'joinRoom', roomId: 'a1b2c3d4' },
  { kind: 'leaveRoom' },
  { kind: 'claimSeat', player: 2 },
  { kind: 'claimSeat', player: null },
  { kind: 'moveMember', nick: 'Bartek', player: 2 },
  { kind: 'moveMember', nick: 'Bartek', player: null },
  { kind: 'setSeat', player: 1, mode: 'computer', color: 4 },
  { kind: 'setSeat', player: 1 },
  { kind: 'setSeat', player: 1, tribe: 4 },
  { kind: 'setSeat', player: 1, tribe: MAX_TRIBE_ID },
  { kind: 'setReady', ready: true },
  { kind: 'setCompatibility', compatibility: COMPATIBILITY },
  { kind: 'setCompatibility', compatibility: null },
  {
    kind: 'setSettings',
    settings: { name: settings.name, seed: settings.seed, rules: settings.rules, speed: settings.speed },
  },
  { kind: 'start' },
  { kind: 'loaded', tick: 1, world: 0 },
  { kind: 'loaded', tick: 300, world: 240 },
  { kind: 'loaded', tick: null },
  { kind: 'loading', progress: 0 },
  { kind: 'loading', progress: MAX_LOADING_PROGRESS },
  { kind: 'ack', tick: 12, digest: DIGEST, world: 0, load: { tickMs: 3.25, buffered: 2 } },
  {
    kind: 'ack',
    tick: 13,
    digest: DIGEST,
    world: 0,
    load: { tickMs: MAX_REPORTED_TICK_MS, buffered: MAX_REPORTED_BUFFERED },
  },
  {
    kind: 'command',
    envelope: { v: 2, origin: 'player', player: 0, command: MOVE_ORDER },
    fromTick: 12,
  },
  { kind: 'clock', speed: 2 },
  ...(['auto', 'responsive', 'balanced', 'smooth'] as const).map((mode) => ({
    kind: 'responsiveness' as const,
    mode,
  })),
  { kind: 'clock', paused: true },
  { kind: 'kick', player: 1, yes: true },
  { kind: 'kick', player: 1, yes: false },
  { kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 40, bytes: BLOB },
  { kind: 'blob', type: 'save', to: 'Ania', tick: 40, bytes: BLOB },
  { kind: 'blob', type: 'map', to: null, tick: null, bytes: BLOB },
  { kind: 'chat', text: 'gotowi?' },
  { kind: 'hallChat', text: 'ktoś gra?' },
  { kind: 'pong', t: 1234.5 },
];

describe('client messages', () => {
  it.each([undefined, null, -1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1])(
    'rejects a snapshot upload with invalid world generation %j',
    (world) => {
      expect(() =>
        parseClientMessage({ kind: 'blob', type: 'snapshot', to: null, tick: 40, bytes: BLOB, world }),
      ).toThrow(/blob.world/);
    },
  );

  for (const message of CLIENT_MESSAGES) {
    it(`round-trips ${message.kind}`, () => {
      expect(parseClientMessage(wire(message))).toEqual(message);
    });
  }

  it.each(['🇵🇱', 'pl', null])(
    'leaves out a hello flag %j it cannot read, so any hello still parses',
    (flag) => {
      expect(
        parseClientMessage({ kind: 'hello', protocol: 1, token: TOKEN, nick: 'A', flag }),
      ).not.toHaveProperty('flag');
    },
  );

  it.each<[string, unknown, RegExp]>([
    ['an unknown kind', { kind: 'teleport' }, /message\.kind/],
    ['a moved nick with a newline', { kind: 'moveMember', nick: 'A\nB', player: 0 }, /control character/],
    ['a moved member without a seat', { kind: 'moveMember', nick: 'A' }, /moveMember\.player/],
    ['a move to a fractional seat', { kind: 'moveMember', nick: 'A', player: 0.5 }, /moveMember\.player/],
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
          { player: 2, mode: 'computer', claimable: true, offers: ['idle', 'computer', 'absent'], color: 0 },
          { player: 1, mode: 'computer', claimable: true, offers: ['idle', 'computer', 'absent'], color: 0 },
        ],
      },
      /ascending/,
    ],
    [
      'a seat mode the seat does not offer',
      {
        kind: 'createRoom',
        settings,
        seats: [{ player: 0, mode: 'absent', claimable: true, offers: ['idle', 'computer'], color: 0 }],
      },
      /does not offer absent/,
    ],
    [
      'a seat past the last one',
      { kind: 'createRoom', settings, seats: [{ player: 16, mode: 'computer', color: 0 }] },
      /past the last seat/,
    ],
    [
      'a fog rule the sim has no mode for',
      { kind: 'createRoom', settings: { ...settings, rules: { ...settings.rules, fog: 9 } }, seats: [] },
      /not a fog mode/,
    ],
    [
      'a weather mode no client draws',
      {
        kind: 'createRoom',
        settings: { ...settings, rules: { ...settings.rules, weather: 'rain' } },
        seats: [],
      },
      /rules\.weather/,
    ],
    [
      'a peace length the lobby does not offer',
      {
        kind: 'createRoom',
        settings: { ...settings, rules: { ...settings.rules, peace: 50 } },
        seats: [],
      },
      /rules\.peace/,
    ],
    [
      'rules without a weather mode',
      {
        kind: 'createRoom',
        settings: { ...settings, rules: { fog: 1, progression: null, needs: false } },
        seats: [],
      },
      /rules\.weather/,
    ],
    [
      'a seed wider than the sim reads',
      { kind: 'createRoom', settings: { ...settings, seed: 2 ** 32 }, seats: [] },
      /wider than 32 bits/,
    ],
    [
      'a saved start at tick 0',
      {
        kind: 'createRoom',
        settings: { ...settings, initialSave: { fingerprint: 'c'.repeat(64), tick: 0 } },
        seats: [],
      },
      /tick 1 or later/,
    ],
    ['a tribe 0', { kind: 'setSeat', player: 0, tribe: 0 }, /setSeat\.tribe/],
    ['a tribe past the bound', { kind: 'setSeat', player: 0, tribe: MAX_TRIBE_ID + 1 }, /setSeat\.tribe/],
    ['a fractional tribe', { kind: 'setSeat', player: 0, tribe: 1.5 }, /setSeat\.tribe/],
    [
      'a seat tribe without the authored one',
      {
        kind: 'createRoom',
        settings,
        seats: [{ player: 0, mode: 'computer', claimable: true, offers: ['computer'], color: 0, tribe: 2 }],
      },
      /without an authored tribe/,
    ],
    [
      'an authored tribe 0',
      {
        kind: 'createRoom',
        settings,
        seats: [
          { player: 0, mode: 'computer', claimable: true, offers: ['computer'], color: 0, authoredTribe: 0 },
        ],
      },
      /authoredTribe/,
    ],
    [
      'a human seat setup',
      { kind: 'createRoom', settings, seats: [{ player: 0, mode: 'human', color: 0 }] },
      /one of map-ai, computer, idle/,
    ],
    [
      'a trusted envelope',
      {
        kind: 'command',
        envelope: { v: 2, origin: 'admin', command: { kind: 'debugKill', entity: 1 } },
        fromTick: 0,
      },
      /player envelopes only/,
    ],
    [
      'an envelope without a command kind',
      { kind: 'command', envelope: { v: 2, origin: 'player', player: 0, command: {} }, fromTick: 0 },
      /command\.kind/,
    ],
    ['a clock change naming nothing', { kind: 'clock' }, /neither/],
    ['a zero speed', { kind: 'clock', speed: 0 }, /clock\.speed/],
    ['a negative pong', { kind: 'pong', t: -1 }, /pong\.t/],
    ['an empty chat line', { kind: 'chat', text: '   ' }, /empty/],
    [
      'a digest missing a domain',
      { kind: 'ack', tick: 1, digest: { ...DIGEST, fog: undefined }, world: 0, load: LOAD },
      /digest\.fog/,
    ],
    [
      'a digest with a stray domain',
      { kind: 'ack', tick: 1, digest: { ...DIGEST, magic: 1 }, world: 0, load: LOAD },
      /unknown domain/,
    ],
    [
      'a digest word past 32 bits',
      { kind: 'ack', tick: 1, digest: { ...DIGEST, rng: 2 ** 32 }, world: 0, load: LOAD },
      /32-bit/,
    ],
    ['an ack without its load', { kind: 'ack', tick: 1, digest: DIGEST, world: 0 }, /ack\.load/],
    [
      'boot progress past whole',
      { kind: 'loading', progress: MAX_LOADING_PROGRESS + 1 },
      /loading\.progress/,
    ],
    ['fractional boot progress', { kind: 'loading', progress: 0.5 }, /loading\.progress/],
    [
      'a negative tick cost',
      { kind: 'ack', tick: 1, digest: DIGEST, world: 0, load: { ...LOAD, tickMs: -1 } },
      /ack\.load\.tickMs/,
    ],
    [
      'a fractional backlog',
      { kind: 'ack', tick: 1, digest: DIGEST, world: 0, load: { ...LOAD, buffered: 0.5 } },
      /ack\.load\.buffered/,
    ],
    [
      'a tick cost past the reported bound',
      { kind: 'ack', tick: 1, digest: DIGEST, world: 0, load: { ...LOAD, tickMs: MAX_REPORTED_TICK_MS + 1 } },
      /ack\.load\.tickMs/,
    ],
    [
      'a backlog past the reported bound',
      {
        kind: 'ack',
        tick: 1,
        digest: DIGEST,
        world: 0,
        load: { ...LOAD, buffered: MAX_REPORTED_BUFFERED + 1 },
      },
      /ack\.load\.buffered/,
    ],
    ['a kick without its yes', { kind: 'kick', player: 1 }, /kick\.yes/],
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
  { kind: 'ended', tick: 12, hash: '0123abcd' },
  { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania2' },
  { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania', build: 'relay-1' },
  {
    kind: 'rooms',
    rooms: [
      {
        id: 'a1b2c3d4',
        name: settings.name,
        state: 'lobby',
        members: ['Ania'],
        seats: 4,
        world: settings.world,
        playedMs: null,
      },
    ],
  },
  {
    kind: 'rooms',
    rooms: [
      {
        id: 'e5f6',
        name: 'Bitwa',
        state: 'running',
        members: [],
        seats: 2,
        world: settings.world,
        playedMs: 61_500,
      },
    ],
  },
  {
    kind: 'presence',
    online: [
      { nick: 'Ania', flag: 'PL', room: 'a1b2c3d4' },
      { nick: 'Bartek', room: null },
    ],
    recent: [{ nick: 'Celina', at: 1_767_297_600_000 }],
  },
  { kind: 'hallChat', from: 'Ania', text: 'ktoś gra?', at: 1_767_297_600_000 },
  { kind: 'hallChat', from: 'Li', flag: 'CN', text: 'hello', at: 1_767_297_600_000 },
  {
    kind: 'hallChatHistory',
    lines: [{ from: 'Ania', text: 'ktoś gra?', at: 1_767_297_600_000 }],
    replaces: false,
  },
  {
    kind: 'room',
    room: {
      id: 'a1b2c3d4',
      state: 'lobby',
      creator: 'Ania',
      settings,
      seats: [
        {
          player: 0,
          mode: 'human',
          claimable: true,
          offers: ['idle', 'computer', 'absent'],
          color: 0,
          nick: 'Ania',
          ready: true,
        },
        {
          player: 1,
          mode: 'computer',
          claimable: false,
          offers: ['idle', 'computer', 'absent'],
          color: 4,
          nick: null,
          ready: false,
        },
        {
          player: 2,
          mode: 'idle',
          claimable: true,
          offers: ['idle'],
          color: 5,
          authoredTribe: 1,
          tribe: 3,
          nick: null,
          ready: false,
        },
      ],
      members: [
        {
          nick: 'Ania',
          flag: 'PL',
          seat: 0,
          connected: true,
          compatibility: COMPATIBILITY,
          load: { tickMs: 4.5, buffered: 1 },
          loading: 30,
          roundTripMs: 42.5,
          delayTicks: 3,
          behindTicks: 7,
        },
        {
          nick: 'Bartek',
          seat: null,
          connected: false,
          compatibility: null,
          load: null,
          loading: null,
          roundTripMs: null,
          delayTicks: null,
          behindTicks: 0,
        },
      ],
    },
  },
  { kind: 'left' },
  { kind: 'start', session, snapshotTick: null },
  { kind: 'start', session, snapshotTick: 300 },
  { kind: 'clock', tick: 40, speed: 2, paused: false, by: 'Ania', governed: null },
  { kind: 'responsiveness', mode: 'auto', bufferTicks: 6, by: null },
  { kind: 'responsiveness', mode: 'responsive', bufferTicks: 1, by: 'Ania' },
  {
    kind: 'clock',
    tick: 1,
    speed: 1,
    paused: false,
    by: null,
    governed: { nick: 'Bartek', speed: 0.5, cause: 'load' },
  },
  {
    kind: 'clock',
    tick: 2,
    speed: 3,
    paused: false,
    by: null,
    governed: { nick: 'Bartek', speed: 2.4, cause: 'lag' },
  },
  {
    kind: 'frame',
    tick: 41,
    commands: [
      { envelope: { v: 2, origin: 'player', player: 0, command: STANCE_ORDER }, sequence: 0 },
      { envelope: { v: 2, origin: 'player', player: 1, command: STANCE_ORDER }, sequence: 1 },
    ],
  },
  { kind: 'delay', ticks: 3 },
  {
    kind: 'waiting',
    for: [
      { nick: 'Ania', reason: 'gone', voteAfterMs: 60000 },
      { nick: 'Cezary', reason: 'resync', voteAfterMs: 0 },
      { nick: 'Dorota', reason: 'slow', voteAfterMs: 30000 },
    ],
  },
  { kind: 'waiting', for: [] },
  { kind: 'kickVote', player: 0, nick: 'Ania', yes: ['Bartek'], needed: 2 },
  { kind: 'kicked', player: 0, nick: 'Ania', mode: 'computer', cause: 'vote', tick: 42 },
  { kind: 'kicked', player: 1, nick: 'Bartek', mode: 'idle', cause: 'loadingTimedOut', tick: 3 },
  { kind: 'desync', tick: 41, domains: ['rng', 'economy'], reference: 'Ania' },
  { kind: 'disputed', tick: 41, domains: ['rng', 'economy'], diverged: ['Bartek', 'Celina'] },
  { kind: 'snapshotRequest' },
  { kind: 'blob', type: 'snapshot', from: 'Ania', tick: 40, bytes: BLOB },
  {
    kind: 'frame',
    tick: 42,
    commands: [
      {
        envelope: {
          v: 2,
          origin: 'admin',
          command: {
            kind: 'setAiControl',
            player: 0,
            enabled: true,
            computerEnabled: true,
            mapAiEnabled: true,
          },
        },
        sequence: 0,
      },
    ],
  },
  { kind: 'chat', from: 'Ania', flag: 'PL', text: 'gotowi?', at: 1_767_297_600_000, tick: null },
  { kind: 'chat', from: 'Ania', text: 'atak!', at: 1_767_297_660_500, tick: 1200 },
  {
    kind: 'chatHistory',
    lines: [
      { from: 'Ania', text: 'gotowi?', at: 1_767_297_600_000, tick: null },
      { from: 'Bartek', text: 'tak', at: 1_767_297_605_000, tick: 40 },
    ],
  },
  { kind: 'chatHistory', lines: [] },
  { kind: 'ping', t: 99, roundTripMs: 42.5 },
  { kind: 'rejected', of: 'command', reason: { code: 'seatRequired' } },
  { kind: 'rejected', of: 'claimSeat', reason: { code: 'seatNotClaimable', player: 2 } },
  { kind: 'rejected', of: 'claimSeat', reason: { code: 'seatTaken', player: 2, nick: 'Bartek' } },
  { kind: 'rejected', of: 'moveMember', reason: { code: 'notMember', nick: 'Bartek' } },
  {
    kind: 'rejected',
    of: 'setReady',
    reason: { code: 'incompatible', nick: 'Ania', kind: 'map', reason: 'missing' },
  },
  { kind: 'error', reason: { code: 'protocolUnsupported', client: 7, relay: 9 } },
];

describe('server messages', () => {
  it('refuses a flag beside a nick the relay sent that is no code', () => {
    expect(() =>
      parseServerMessage({ kind: 'hallChat', from: 'A', flag: 'pl', text: 'hej', at: 1 }, parseSession),
    ).toThrow(/hallChat\.flag/);
  });

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
      commands: [{ envelope: { v: 2, origin: 'player', player: 0, command: { kind: 'x' } }, sequence: 1 }],
    };
    expect(() => parseServerMessage(frame, parseSession)).toThrow(/sequence 1 out of order/);
  });

  it('refuses a trusted envelope in a frame other than the relay’s one allowed command', () => {
    const frame = (command: Record<string, unknown>) => ({
      kind: 'frame',
      tick: 1,
      commands: [{ envelope: { v: 2, origin: 'admin', command }, sequence: 0 }],
    });
    expect(() => parseServerMessage(frame({ kind: 'debugKill', entity: 1 }), parseSession)).toThrow(
      /setAiControl only/,
    );
    expect(() =>
      parseServerMessage(frame({ kind: 'setAiControl', player: 0, enabled: false }), parseSession),
    ).toThrow(/enabled/);
    for (const gates of [
      {},
      { computerEnabled: false, mapAiEnabled: true },
      { computerEnabled: true, mapAiEnabled: false },
    ]) {
      expect(() =>
        parseServerMessage(frame({ kind: 'setAiControl', player: 0, enabled: true, ...gates }), parseSession),
      ).toThrow(/departure requires/);
    }
    expect(() =>
      parseServerMessage(
        {
          kind: 'frame',
          tick: 1,
          commands: [{ envelope: { v: 2, origin: 'setup', command: {} }, sequence: 0 }],
        },
        parseSession,
      ),
    ).toThrow(/player envelopes only/);
  });

  it('refuses a seat view carrying one of its two tribes', () => {
    const view = (seat: Record<string, unknown>) => ({
      kind: 'room',
      room: {
        id: 'a1b2c3d4',
        state: 'lobby',
        creator: 'Ania',
        settings,
        seats: [
          {
            player: 0,
            mode: 'idle',
            claimable: true,
            offers: ['idle'],
            color: 0,
            nick: null,
            ready: false,
            ...seat,
          },
        ],
        members: [],
      },
    });
    expect(() => parseServerMessage(view({ authoredTribe: 1 }), parseSession)).toThrow(/missing beside/);
    expect(() => parseServerMessage(view({ tribe: 1 }), parseSession)).toThrow(/without an authored tribe/);
  });

  it('refuses a wait reason and a desync domain it does not know', () => {
    for (const reason of ['bored', 'lagging'])
      expect(() =>
        parseServerMessage({ kind: 'waiting', for: [{ nick: 'A', reason, voteAfterMs: 0 }] }, parseSession),
      ).toThrow(/reason/);
    expect(() =>
      parseServerMessage({ kind: 'desync', tick: 1, domains: ['weather'], reference: 'A' }, parseSession),
    ).toThrow(/domains\[0\]/);
  });

  it('refuses a reason code it does not know, prose, and a code missing or mistyping its values', () => {
    for (const reason of [
      'the game has started',
      { code: 'bored' },
      { code: 'seatTaken' },
      { code: 'seatTaken', player: 2, nick: '' },
      { code: 'seatModeUnavailable', player: 1, mode: 'human' },
      { code: 'incompatible', nick: 'A', kind: 'weather', reason: 'missing' },
    ]) {
      expect(() => parseServerMessage({ kind: 'error', reason }, parseSession)).toThrow(/error\.reason/);
    }
  });

  it('names the codes a relay closes a connection with, and no other', () => {
    expect(closingCode('protocolUnsupported')).toBe('protocolUnsupported');
    expect(closingCode('trafficLimit')).toBe('trafficLimit');
    expect(closingCode('gameStarted')).toBeNull();
    expect(closingCode('closed with code 1002')).toBeNull();
  });

  it('refuses a dispute with no domain, no diverged nick, an unknown domain or a negative tick', () => {
    const disputed = { kind: 'disputed', tick: 1, domains: ['rng'], diverged: ['B'] };
    expect(() => parseServerMessage({ ...disputed, domains: [] }, parseSession)).toThrow(/disputed\.domains/);
    expect(() => parseServerMessage({ ...disputed, diverged: [] }, parseSession)).toThrow(
      /disputed\.diverged/,
    );
    expect(() => parseServerMessage({ ...disputed, domains: ['weather'] }, parseSession)).toThrow(
      /domains\[0\]/,
    );
    expect(() => parseServerMessage({ ...disputed, diverged: [' '] }, parseSession)).toThrow(/diverged\[0\]/);
    expect(() => parseServerMessage({ ...disputed, tick: -1 }, parseSession)).toThrow(/disputed\.tick/);
  });

  it('refuses a clock whose governed speed is missing, unnamed or not a positive speed', () => {
    const clock = (governed: unknown) => ({
      kind: 'clock',
      tick: 1,
      speed: 1,
      paused: false,
      by: null,
      governed,
    });
    expect(() => parseServerMessage({ ...clock(null), governed: undefined }, parseSession)).toThrow(
      /clock\.governed/,
    );
    expect(() => parseServerMessage(clock({ nick: ' ', speed: 1, cause: 'load' }), parseSession)).toThrow(
      /governed\.nick/,
    );
    for (const speed of [0, -1, Number.POSITIVE_INFINITY, '1'])
      expect(() => parseServerMessage(clock({ nick: 'A', speed, cause: 'load' }), parseSession)).toThrow(
        /governed\.speed/,
      );
    for (const cause of [undefined, 'machine'])
      expect(() => parseServerMessage(clock({ nick: 'A', speed: 1, cause }), parseSession)).toThrow(
        /governed\.cause/,
      );
  });

  it('refuses a chat line without a stamp or with a negative stamp or tick, and a history past its cap', () => {
    const line = { from: 'Ania', text: 'hej', at: 1, tick: 1 };
    expect(() => parseServerMessage({ kind: 'chat', from: 'Ania', text: 'hej' }, parseSession)).toThrow(
      /chat\.at/,
    );
    expect(() => parseServerMessage({ kind: 'chat', ...line, at: -1 }, parseSession)).toThrow(/chat\.at/);
    expect(() => parseServerMessage({ kind: 'chat', ...line, at: null }, parseSession)).toThrow(/chat\.at/);
    expect(() => parseServerMessage({ kind: 'chat', ...line, tick: -1 }, parseSession)).toThrow(/chat\.tick/);
    expect(() =>
      parseServerMessage({ kind: 'chatHistory', lines: [{ ...line, text: ' ' }] }, parseSession),
    ).toThrow(/chatHistory\.lines\[0\]\.text/);
    const full = Array.from({ length: MAX_CHAT_HISTORY_LINES }, () => line);
    expect(parseServerMessage({ kind: 'chatHistory', lines: full }, parseSession)).toMatchObject({
      lines: { length: MAX_CHAT_HISTORY_LINES },
    });
    expect(() => parseServerMessage({ kind: 'chatHistory', lines: [...full, line] }, parseSession)).toThrow(
      /more than/,
    );
  });

  it('refuses a hall history or presence list past its cap, and a room summary with a negative clock', () => {
    const line = { from: 'Ania', text: 'hej', at: 1 };
    const lines = Array.from({ length: MAX_HALL_CHAT_LINES + 1 }, () => line);
    expect(() => parseServerMessage({ kind: 'hallChatHistory', lines }, parseSession)).toThrow(/more than/);
    const online = Array.from({ length: MAX_PRESENCE_ENTRIES + 1 }, () => ({ nick: 'Ania', room: null }));
    expect(() => parseServerMessage({ kind: 'presence', online, recent: [] }, parseSession)).toThrow(
      /presence\.online/,
    );
    const rooms = SERVER_MESSAGES.find((message) => message.kind === 'rooms');
    if (rooms?.kind !== 'rooms') throw new Error('no rooms fixture');
    const negative = { ...rooms, rooms: [{ ...rooms.rooms[0], playedMs: -1 }] };
    expect(() => parseServerMessage(negative, parseSession)).toThrow(/playedMs/);
  });

  it('refuses a room member whose link or lag figures are missing or out of range', () => {
    const room = SERVER_MESSAGES.find((message) => message.kind === 'room');
    if (room?.kind !== 'room') throw new Error('no room fixture');
    const withFigures = (figures: object) => ({
      ...room,
      room: { ...room.room, members: room.room.members.map((member) => ({ ...member, ...figures })) },
    });
    for (const [figures, at] of [
      [{ roundTripMs: -1 }, /members\[0\]\.roundTripMs/],
      [{ roundTripMs: undefined }, /members\[0\]\.roundTripMs/],
      [{ delayTicks: 1.5 }, /members\[0\]\.delayTicks/],
      [{ behindTicks: null }, /members\[0\]\.behindTicks/],
      [{ behindTicks: -1 }, /members\[0\]\.behindTicks/],
    ] as const)
      expect(() => parseServerMessage(wire(withFigures(figures)), parseSession)).toThrow(at);
  });

  it('refuses a room member whose load is missing', () => {
    const room = SERVER_MESSAGES.find((message) => message.kind === 'room');
    if (room?.kind !== 'room') throw new Error('no room fixture');
    const members = room.room.members.map(({ load: _load, ...member }) => member);
    expect(() =>
      parseServerMessage(wire({ ...room, room: { ...room.room, members } }), parseSession),
    ).toThrow(/members\[0\]\.load/);
  });

  it('refuses a room member whose load is past the reported bounds', () => {
    const room = SERVER_MESSAGES.find((message) => message.kind === 'room');
    if (room?.kind !== 'room') throw new Error('no room fixture');
    const withLoad = (load: object) => ({
      ...room,
      room: { ...room.room, members: room.room.members.map((member) => ({ ...member, load })) },
    });
    expect(() =>
      parseServerMessage(wire(withLoad({ tickMs: MAX_REPORTED_TICK_MS + 1, buffered: 0 })), parseSession),
    ).toThrow(/members\[0\]\.load\.tickMs/);
    expect(() =>
      parseServerMessage(wire(withLoad({ tickMs: 1, buffered: MAX_REPORTED_BUFFERED + 1 })), parseSession),
    ).toThrow(/members\[0\]\.load\.buffered/);
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

describe('terminal result validation', () => {
  it.each(['', '0123456', '012345678', '0123ABCd', 'notahash', 12, null])(
    'rejects invalid result hash %s',
    (hash) => {
      expect(() => parseClientMessage({ kind: 'finish', tick: 12, hash, world: 0 })).toThrow(/finish.hash/);
    },
  );
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid terminal tick %s', (tick) => {
    expect(() => parseServerMessage({ kind: 'ended', tick }, () => session)).toThrow();
  });
});

describe('responsiveness wire bounds', () => {
  it('rejects unknown modes in both directions', () => {
    for (const mode of ['', 'fast', null, 1]) {
      expect(() => parseClientMessage({ kind: 'responsiveness', mode })).toThrow(/responsiveness.mode/);
      expect(() =>
        parseServerMessage({ kind: 'responsiveness', mode, bufferTicks: 2, by: null }, () => session),
      ).toThrow(/responsiveness.mode/);
    }
  });
  it('rejects missing, fractional and out-of-range buffers and unprintable authors', () => {
    for (const bufferTicks of [undefined, 0, 7, 1.5, Infinity]) {
      expect(() =>
        parseServerMessage({ kind: 'responsiveness', mode: 'auto', bufferTicks, by: null }, () => session),
      ).toThrow(/responsiveness.bufferTicks/);
    }
    expect(() =>
      parseServerMessage({ kind: 'responsiveness', mode: 'auto', bufferTicks: 2, by: 'a\nb' }, () => session),
    ).toThrow(/responsiveness.by/);
  });
});

it.each([undefined, null, 0, 'true'])('rejects a non-boolean claimability flag: %s', (claimable) => {
  expect(() =>
    parseClientMessage({
      kind: 'createRoom',
      settings,
      seats: [{ player: 0, mode: 'computer', offers: ['computer'], color: 0, claimable }],
    }),
  ).toThrow();
});

describe('reserved map AI control', () => {
  const seatSetup = (control: Record<string, unknown>) => ({ player: 0, color: 0, ...control });
  const roomView = (control: Record<string, unknown>) => ({
    kind: 'room',
    room: {
      id: 'a1b2c3d4',
      state: 'lobby',
      creator: 'Ania',
      settings,
      seats: [{ ...seatSetup(control), nick: null, ready: false }],
      members: [],
    },
  });

  it.each([
    { mode: 'map-ai', claimable: true, offers: ['map-ai'] },
    { mode: 'idle', claimable: true, offers: ['idle', 'computer', 'absent', 'map-ai'] },
    { mode: 'map-ai', claimable: false, offers: ['map-ai', 'computer'] },
    { mode: 'map-ai', claimable: false, offers: ['map-ai', 'idle'] },
    { mode: 'map-ai', claimable: false, offers: ['map-ai', 'absent'] },
    { mode: 'computer', claimable: false, offers: ['map-ai'] },
    { mode: 'map-ai', claimable: false, offers: ['computer'] },
  ])('rejects invalid control in both directions: %j', (control) => {
    expect(() => parseClientMessage({ kind: 'createRoom', settings, seats: [seatSetup(control)] })).toThrow(
      /map-ai|does not offer/,
    );
    expect(() => parseServerMessage(roomView(control), () => session)).toThrow(/map-ai|does not offer/);
  });

  it.each([
    { mode: 'map-ai', claimable: false, offers: ['map-ai'] },
    { mode: 'computer', claimable: true, offers: ['computer', 'idle', 'absent'] },
    { mode: 'idle', claimable: true, offers: ['computer', 'idle', 'absent'] },
    { mode: 'absent', claimable: true, offers: ['computer', 'idle', 'absent'] },
  ])('round trips valid control in both directions: %j', (control) => {
    const create = { kind: 'createRoom', settings, seats: [seatSetup(control)] };
    expect(parseClientMessage(wire(create))).toEqual(create);
    const view = roomView(control);
    expect(parseServerMessage(wire(view), () => session)).toEqual(view);
  });

  it('allows an idle departure in a view even when the lobby only offered computer', () => {
    const view = roomView({ mode: 'idle', claimable: true, offers: ['computer'] });
    view.room.state = 'running';
    expect(parseServerMessage(wire(view), () => session)).toEqual(view);
  });

  it('rejects a human occupying a reserved seat', () => {
    expect(() =>
      parseServerMessage(roomView({ mode: 'human', claimable: false, offers: ['map-ai'] }), () => session),
    ).toThrow(/reserved seat cannot be human/);
  });
});

describe('catalogue map announcements', () => {
  const catalogMap = { entryId: 'cn-zatoka', mapId: 'zatoka', fingerprint: 'd'.repeat(64), irVersion: 3 };
  const create = (extra: Record<string, unknown>) => ({
    kind: 'createRoom',
    settings: { ...settings, ...extra },
    seats: [],
  });

  it('carries a catalogue origin with the map it names through a JSON round trip', () => {
    const message = create({ mapOrigin: 'catalog', catalogMap });
    expect(parseClientMessage(JSON.parse(JSON.stringify(message)))).toEqual(message);
  });

  it.each([
    ['a catalogue origin without its map', { mapOrigin: 'catalog' }, /catalogMap/],
    ['a map without the catalogue origin', { mapOrigin: 'user', catalogMap }, /requires mapOrigin catalog/],
    ['a map without any origin', { catalogMap }, /requires mapOrigin catalog/],
    [
      'a map other than the room world',
      { mapOrigin: 'catalog', catalogMap: { ...catalogMap, mapId: 'other' } },
      /does not name the room's map/,
    ],
    [
      'an entry id that names a path',
      { mapOrigin: 'catalog', catalogMap: { ...catalogMap, entryId: '../x' } },
      /entryId/,
    ],
    [
      'a fingerprint that is not a digest',
      { mapOrigin: 'catalog', catalogMap: { ...catalogMap, fingerprint: 'x' } },
      /fingerprint/,
    ],
    ['content version 0', { mapOrigin: 'catalog', catalogMap: { ...catalogMap, irVersion: 0 } }, /irVersion/],
  ])('refuses %s', (_name, extra, error) => {
    expect(() => parseClientMessage(create(extra))).toThrow(error);
  });

  it('keeps the announcement immutable in setSettings', () => {
    expect(() =>
      parseClientMessage({ kind: 'setSettings', settings: { ...settings, world: undefined, catalogMap } }),
    ).toThrow(/immutable/);
  });
});

describe('map blob transfer budget', () => {
  const parseSession = (): never => {
    throw new Error('A map blob must not parse a session descriptor');
  };
  it('accepts 32 MiB in both directions and rejects one more decoded byte', () => {
    const limit = 32 * 1024 * 1024;
    const bytes = `${'A'.repeat(Math.ceil(limit / 3) * 4 - 1)}=`;
    const upload = { kind: 'blob', type: 'map', to: null, tick: null, bytes };
    const delivery = { kind: 'blob', type: 'map', from: 'Ania', tick: null, bytes };
    expect(parseClientMessage(upload).kind).toBe('blob');
    expect(parseServerMessage(delivery, parseSession).kind).toBe('blob');
    const oversized = `${bytes.slice(0, -1)}A`;
    expect(() => parseClientMessage({ ...upload, bytes: oversized })).toThrow(/over/);
    expect(() => parseServerMessage({ ...delivery, bytes: oversized }, parseSession)).toThrow(/over/);
  });
});
