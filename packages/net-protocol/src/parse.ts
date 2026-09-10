import type { GameSession, SeatMode, SessionRules, SessionWorld } from '@open-northland/lockstep';
import {
  MAX_CHAT_LENGTH,
  MAX_COMMAND_KIND_LENGTH,
  MAX_NICK_LENGTH,
  MAX_REASON_LENGTH,
  MAX_ROOM_ID_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_SEATS,
  MAX_SPEED,
  MAX_TOKEN_LENGTH,
  MAX_WORLD_ID_LENGTH,
  MIN_TOKEN_LENGTH,
} from './limits.js';
import type {
  ClientMessage,
  ClientMessageKind,
  RoomMemberView,
  RoomSeatSetup,
  RoomSeatView,
  RoomSettings,
  RoomState,
  RoomSummary,
  RoomView,
  ServerMessage,
  VacantSeatMode,
  WireCommand,
  WireEnvelope,
} from './messages.js';
import {
  asArray,
  asBoolean,
  asCount,
  asInteger,
  asOneOf,
  asPositiveNumber,
  asRecord,
  asString,
  preview,
  typeName,
} from './untrusted.js';

const CLIENT_KINDS = [
  'hello',
  'listRooms',
  'createRoom',
  'joinRoom',
  'leaveRoom',
  'claimSeat',
  'setSeat',
  'setReady',
  'start',
  'loaded',
  'command',
  'clock',
  'chat',
  'pong',
] as const satisfies readonly ClientMessageKind[];

const SERVER_KINDS = [
  'welcome',
  'rooms',
  'room',
  'left',
  'start',
  'clock',
  'frame',
  'delay',
  'chat',
  'ping',
  'rejected',
  'error',
] as const satisfies readonly ServerMessage['kind'][];

const ROOM_STATES = ['lobby', 'running'] as const satisfies readonly RoomState[];

// Keyed records so that a mode added to the descriptor fails to compile here instead of being refused
// on the wire.
const SEAT_MODE_SET: { readonly [M in SeatMode]: true } = { human: true, ai: true, idle: true };
const SEAT_MODES = Object.keys(SEAT_MODE_SET) as readonly SeatMode[];
const VACANT_SEAT_MODE_SET: { readonly [M in VacantSeatMode]: true } = { ai: true, idle: true };
const VACANT_SEAT_MODES = Object.keys(VACANT_SEAT_MODE_SET) as readonly VacantSeatMode[];

const TOKEN_SHAPE = /^[A-Za-z0-9_-]+$/;
/** No control characters, so a nick or chat line cannot carry a newline or terminal escape. */
const PRINTABLE = /^\P{C}+$/u;

/** The client kind a raw message claims, for naming what was refused; null when it claims none. */
export function clientMessageKind(value: unknown): ClientMessageKind | null {
  if (typeof value !== 'object' || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  return CLIENT_KINDS.find((known) => known === kind) ?? null;
}

export function parseClientMessage(value: unknown): ClientMessage {
  const raw = asRecord(value, 'message');
  const kind = asOneOf(raw.kind, CLIENT_KINDS, 'message.kind');
  switch (kind) {
    case 'hello':
      return {
        kind,
        protocol: asCount(raw.protocol, 'hello.protocol'),
        token: parseToken(raw.token, 'hello.token'),
        nick: parseNick(raw.nick, 'hello.nick'),
      };
    case 'listRooms':
    case 'leaveRoom':
    case 'start':
    case 'loaded':
      return { kind };
    case 'createRoom':
      return {
        kind,
        settings: parseRoomSettings(raw.settings, 'createRoom.settings'),
        seats: parseSeatSetups(raw.seats, 'createRoom.seats'),
      };
    case 'joinRoom':
      return { kind, roomId: asString(raw.roomId, 'joinRoom.roomId', MAX_ROOM_ID_LENGTH) };
    case 'claimSeat':
      return { kind, player: raw.player === null ? null : parseSeatIndex(raw.player, 'claimSeat.player') };
    case 'setSeat':
      return {
        kind,
        player: parseSeatIndex(raw.player, 'setSeat.player'),
        ...(raw.mode !== undefined ? { mode: asOneOf(raw.mode, VACANT_SEAT_MODES, 'setSeat.mode') } : {}),
        ...(raw.color !== undefined ? { color: asCount(raw.color, 'setSeat.color') } : {}),
      };
    case 'setReady':
      return { kind, ready: asBoolean(raw.ready, 'setReady.ready') };
    case 'command':
      return {
        kind,
        envelope: parseWireEnvelope(raw.envelope, 'command.envelope'),
        fromTick: asCount(raw.fromTick, 'command.fromTick'),
      };
    case 'clock': {
      if (raw.speed === undefined && raw.paused === undefined) {
        throw new Error('clock: names neither a speed nor a pause state');
      }
      return {
        kind,
        ...(raw.speed !== undefined ? { speed: asPositiveNumber(raw.speed, 'clock.speed', MAX_SPEED) } : {}),
        ...(raw.paused !== undefined ? { paused: asBoolean(raw.paused, 'clock.paused') } : {}),
      };
    }
    case 'chat':
      return { kind, text: parseLine(raw.text, 'chat.text', MAX_CHAT_LENGTH) };
    case 'pong':
      return { kind, t: asTimestamp(raw.t, 'pong.t') };
    default:
      return assertNever(kind);
  }
}

/**
 * The client side of the wire. The session descriptor belongs to the lockstep package, so its parser
 * is passed in rather than imported: this package carries no runtime dependency.
 */
export function parseServerMessage(
  value: unknown,
  parseSession: (session: unknown) => GameSession,
): ServerMessage {
  const raw = asRecord(value, 'message');
  const kind = asOneOf(raw.kind, SERVER_KINDS, 'message.kind');
  switch (kind) {
    case 'welcome':
      return {
        kind,
        protocol: asCount(raw.protocol, 'welcome.protocol'),
        nick: parseNick(raw.nick, 'welcome.nick'),
      };
    case 'rooms':
      return {
        kind,
        rooms: asArray(raw.rooms, 'rooms.rooms').map((room, i) => parseRoomSummary(room, `rooms[${i}]`)),
      };
    case 'room':
      return { kind, room: parseRoomView(raw.room, 'room.room') };
    case 'left':
      return { kind };
    case 'start':
      return { kind, session: parseSession(raw.session) };
    case 'clock':
      return {
        kind,
        tick: asCount(raw.tick, 'clock.tick'),
        speed: asPositiveNumber(raw.speed, 'clock.speed', MAX_SPEED),
        paused: asBoolean(raw.paused, 'clock.paused'),
        by: raw.by === null ? null : parseNick(raw.by, 'clock.by'),
      };
    case 'frame':
      return {
        kind,
        tick: asCount(raw.tick, 'frame.tick'),
        commands: parseWireCommands(raw.commands, 'frame.commands'),
      };
    case 'delay':
      return { kind, ticks: asCount(raw.ticks, 'delay.ticks') };
    case 'chat':
      return {
        kind,
        from: parseNick(raw.from, 'chat.from'),
        text: parseLine(raw.text, 'chat.text', MAX_CHAT_LENGTH),
      };
    case 'ping':
      return { kind, t: asTimestamp(raw.t, 'ping.t') };
    case 'rejected':
      return {
        kind,
        of: asOneOf(raw.of, CLIENT_KINDS, 'rejected.of'),
        reason: asString(raw.reason, 'rejected.reason', MAX_REASON_LENGTH),
      };
    case 'error':
      return { kind, reason: asString(raw.reason, 'error.reason', MAX_REASON_LENGTH) };
    default:
      return assertNever(kind);
  }
}

export function parseRoomSettings(value: unknown, at: string): RoomSettings {
  const raw = asRecord(value, at);
  return {
    name: parseLine(raw.name, `${at}.name`, MAX_ROOM_NAME_LENGTH),
    world: parseSessionWorld(raw.world, `${at}.world`),
    seed: asCount(raw.seed, `${at}.seed`),
    rules: parseSessionRules(raw.rules, `${at}.rules`),
    speed: asPositiveNumber(raw.speed, `${at}.speed`, MAX_SPEED),
  };
}

/** The wire's own reading of a seat envelope: the authority half only, since the command payload is the
 *  sim's contract and the relay never applies one. */
export function parseWireEnvelope(value: unknown, at: string): WireEnvelope {
  const raw = asRecord(value, at);
  if (raw.origin !== 'player') {
    throw new Error(`${at}: the wire carries player envelopes only, got origin ${preview(raw.origin)}`);
  }
  const command = asRecord(raw.command, `${at}.command`);
  asString(command.kind, `${at}.command.kind`, MAX_COMMAND_KIND_LENGTH);
  return {
    v: asCount(raw.v, `${at}.v`),
    origin: 'player',
    player: asInteger(raw.player, `${at}.player`),
    command: command as { readonly kind: string },
  };
}

function parseWireCommands(value: unknown, at: string): readonly WireCommand[] {
  return asArray(value, at).map((entry, i) => {
    const raw = asRecord(entry, `${at}[${i}]`);
    const sequence = asCount(raw.sequence, `${at}[${i}].sequence`);
    // The relay numbers a frame's commands 0..n-1 in order; anything else is not a relay frame.
    if (sequence !== i) throw new Error(`${at}[${i}]: sequence ${sequence} out of order`);
    return { envelope: parseWireEnvelope(raw.envelope, `${at}[${i}].envelope`), sequence };
  });
}

function parseSessionWorld(value: unknown, at: string): SessionWorld {
  const raw = asRecord(value, at);
  const kind = asOneOf(raw.kind, ['map', 'scene'], `${at}.kind`);
  switch (kind) {
    case 'map':
      return { kind, mapId: parseLine(raw.mapId, `${at}.mapId`, MAX_WORLD_ID_LENGTH) };
    case 'scene':
      return { kind, sceneId: parseLine(raw.sceneId, `${at}.sceneId`, MAX_WORLD_ID_LENGTH) };
    default:
      return assertNever(kind);
  }
}

function parseSessionRules(value: unknown, at: string): SessionRules {
  const raw = asRecord(value, at);
  return {
    fog: raw.fog === null ? null : asCount(raw.fog, `${at}.fog`),
    progression: raw.progression === null ? null : asBoolean(raw.progression, `${at}.progression`),
    needs: raw.needs === null ? null : asBoolean(raw.needs, `${at}.needs`),
  };
}

/** Seats arrive in ascending order, the order the descriptor holds them to. */
function parseSeatSetups(value: unknown, at: string): readonly RoomSeatSetup[] {
  const seats = asArray(value, at);
  if (seats.length > MAX_SEATS) throw new Error(`${at}: more than ${MAX_SEATS} seats`);
  let previous = -1;
  return seats.map((entry, i) => {
    const raw = asRecord(entry, `${at}[${i}]`);
    const player = parseSeatIndex(raw.player, `${at}[${i}].player`);
    if (player <= previous) throw new Error(`${at}[${i}]: seat ${player} out of ascending order`);
    previous = player;
    return {
      player,
      mode: asOneOf(raw.mode, VACANT_SEAT_MODES, `${at}[${i}].mode`),
      color: asCount(raw.color, `${at}[${i}].color`),
    };
  });
}

function parseRoomView(value: unknown, at: string): RoomView {
  const raw = asRecord(value, at);
  return {
    id: asString(raw.id, `${at}.id`, MAX_ROOM_ID_LENGTH),
    state: asOneOf(raw.state, ROOM_STATES, `${at}.state`),
    creator: parseNick(raw.creator, `${at}.creator`),
    settings: parseRoomSettings(raw.settings, `${at}.settings`),
    seats: asArray(raw.seats, `${at}.seats`).map((seat, i) => parseRoomSeatView(seat, `${at}.seats[${i}]`)),
    members: asArray(raw.members, `${at}.members`).map((member, i) =>
      parseRoomMemberView(member, `${at}.members[${i}]`),
    ),
  };
}

function parseRoomSeatView(value: unknown, at: string): RoomSeatView {
  const raw = asRecord(value, at);
  return {
    player: parseSeatIndex(raw.player, `${at}.player`),
    mode: asOneOf(raw.mode, SEAT_MODES, `${at}.mode`),
    color: asCount(raw.color, `${at}.color`),
    nick: raw.nick === null ? null : parseNick(raw.nick, `${at}.nick`),
    ready: asBoolean(raw.ready, `${at}.ready`),
  };
}

function parseRoomMemberView(value: unknown, at: string): RoomMemberView {
  const raw = asRecord(value, at);
  return {
    nick: parseNick(raw.nick, `${at}.nick`),
    seat: raw.seat === null ? null : parseSeatIndex(raw.seat, `${at}.seat`),
    connected: asBoolean(raw.connected, `${at}.connected`),
  };
}

function parseRoomSummary(value: unknown, at: string): RoomSummary {
  const raw = asRecord(value, at);
  return {
    id: asString(raw.id, `${at}.id`, MAX_ROOM_ID_LENGTH),
    name: parseLine(raw.name, `${at}.name`, MAX_ROOM_NAME_LENGTH),
    state: asOneOf(raw.state, ROOM_STATES, `${at}.state`),
    members: asCount(raw.members, `${at}.members`),
    seats: asCount(raw.seats, `${at}.seats`),
  };
}

function parseSeatIndex(value: unknown, at: string): number {
  const player = asCount(value, at);
  if (player >= MAX_SEATS) throw new Error(`${at}: seat ${player} is past the last seat ${MAX_SEATS - 1}`);
  return player;
}

function parseToken(value: unknown, at: string): string {
  const token = asString(value, at, MAX_TOKEN_LENGTH);
  if (token.length < MIN_TOKEN_LENGTH || !TOKEN_SHAPE.test(token)) {
    throw new Error(`${at}: expected ${MIN_TOKEN_LENGTH} to ${MAX_TOKEN_LENGTH} url-safe characters`);
  }
  return token;
}

export function parseNick(value: unknown, at: string): string {
  return parseLine(value, at, MAX_NICK_LENGTH);
}

/** One printable line, trimmed and non-empty. */
function parseLine(value: unknown, at: string, maxLength: number): string {
  const line = asString(value, at, maxLength).trim();
  if (line.length === 0) throw new Error(`${at}: empty`);
  if (!PRINTABLE.test(line)) throw new Error(`${at}: holds a control character`);
  return line;
}

function asTimestamp(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${at}: expected a non-negative number, got ${typeName(value)}`);
  }
  return value;
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
