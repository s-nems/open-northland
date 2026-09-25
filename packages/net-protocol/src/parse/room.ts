import type { SeatMode, SessionRules, SessionWorld } from '@open-northland/lockstep';
import {
  FOG_MODES,
  MAX_ROOM_ID_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_SEATS,
  MAX_SEED,
  MAX_SPEED,
  MAX_WORLD_ID_LENGTH,
} from '../limits.js';
import type {
  DepartedSeatMode,
  LobbySettings,
  RoomMemberView,
  RoomSeatSetup,
  RoomSeatView,
  RoomSettings,
  RoomState,
  RoomSummary,
  RoomView,
  VacantSeatMode,
} from '../messages.js';
import {
  asArray,
  asBoolean,
  asCount,
  asOneOf,
  asPositiveNumber,
  asRecord,
  asString,
  keysOf,
} from '../untrusted.js';
import { fingerprint, parseCompatibility } from './compatibility.js';
import { assertNever, parseLine, parseNick } from './text.js';

const ROOM_STATES = ['lobby', 'running', 'ended'] as const satisfies readonly RoomState[];

const SEAT_MODES = keysOf<SeatMode>({ human: true, ai: true, idle: true, absent: true });
export const VACANT_SEAT_MODES = keysOf<VacantSeatMode>({ ai: true, idle: true, absent: true });
export const DEPARTED_SEAT_MODES = keysOf<DepartedSeatMode>({ ai: true, idle: true });

export function parseRoomSettings(value: unknown, at: string): RoomSettings {
  const raw = asRecord(value, at);
  return {
    ...parseLobbySettings(raw, at),
    world: parseSessionWorld(raw.world, `${at}.world`),
    ...(raw.initialSave === undefined
      ? {}
      : { initialSave: parseInitialSave(raw.initialSave, `${at}.initialSave`) }),
    ...(raw.mapOrigin === undefined
      ? {}
      : { mapOrigin: asOneOf(raw.mapOrigin, ['mod', 'user'], `${at}.mapOrigin`) }),
  };
}

export function parseLobbySettings(value: unknown, at: string): LobbySettings {
  const raw = asRecord(value, at);
  return {
    name: parseLine(raw.name, `${at}.name`, MAX_ROOM_NAME_LENGTH),
    seed: parseSeed(raw.seed, `${at}.seed`),
    rules: parseSessionRules(raw.rules, `${at}.rules`),
    speed: asPositiveNumber(raw.speed, `${at}.speed`, MAX_SPEED),
    ...(raw.kickedSeatMode === undefined
      ? {}
      : { kickedSeatMode: asOneOf(raw.kickedSeatMode, DEPARTED_SEAT_MODES, `${at}.kickedSeatMode`) }),
  };
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

function parseSeed(value: unknown, at: string): number {
  const seed = asCount(value, at);
  if (seed > MAX_SEED) throw new Error(`${at}: seed ${seed} is wider than 32 bits`);
  return seed;
}

function parseFogMode(value: unknown, at: string): number {
  const fog = asCount(value, at);
  if (!FOG_MODES.includes(fog)) throw new Error(`${at}: ${fog} is not a fog mode`);
  return fog;
}

function parseSessionRules(value: unknown, at: string): SessionRules {
  const raw = asRecord(value, at);
  return {
    fog: raw.fog === null ? null : parseFogMode(raw.fog, `${at}.fog`),
    progression: raw.progression === null ? null : asBoolean(raw.progression, `${at}.progression`),
    needs: raw.needs === null ? null : asBoolean(raw.needs, `${at}.needs`),
  };
}

/** Seats arrive in ascending order, the order the descriptor holds them to. */
export function parseSeatSetups(value: unknown, at: string): readonly RoomSeatSetup[] {
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
      ...(raw.team === undefined ? {} : { team: parseTeam(raw.team, `${at}[${i}].team`) }),
    };
  });
}

export function parseRoomView(value: unknown, at: string): RoomView {
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
    ...(raw.team === undefined ? {} : { team: parseTeam(raw.team, `${at}.team`) }),
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
    compatibility: parseCompatibility(raw.compatibility, `${at}.compatibility`),
  };
}

export function parseRoomSummary(value: unknown, at: string): RoomSummary {
  const raw = asRecord(value, at);
  return {
    id: asString(raw.id, `${at}.id`, MAX_ROOM_ID_LENGTH),
    name: parseLine(raw.name, `${at}.name`, MAX_ROOM_NAME_LENGTH),
    state: asOneOf(raw.state, ROOM_STATES, `${at}.state`),
    members: asCount(raw.members, `${at}.members`),
    seats: asCount(raw.seats, `${at}.seats`),
  };
}

export function parseSeatIndex(value: unknown, at: string): number {
  const player = asCount(value, at);
  if (player >= MAX_SEATS) throw new Error(`${at}: seat ${player} is past the last seat ${MAX_SEATS - 1}`);
  return player;
}

export function parseTeam(value: unknown, at: string): number | null {
  return value === null ? null : parseSeatIndex(value, at);
}

/** A saved start stands past tick 0, where a freshly built world would be indistinguishable. */
function parseInitialSave(value: unknown, at: string) {
  const raw = asRecord(value, at);
  const tick = asCount(raw.tick, `${at}.tick`);
  if (tick < 1) throw new Error(`${at}.tick: a save stands at tick 1 or later`);
  return { fingerprint: fingerprint(raw.fingerprint, `${at}.fingerprint`), tick };
}
