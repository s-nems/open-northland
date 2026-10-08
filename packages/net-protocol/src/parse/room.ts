import type {
  AiDifficulty,
  SeatMode,
  SessionRules,
  SessionWorld,
  WeatherMode,
} from '@open-northland/lockstep';
import {
  FOG_MODES,
  MAX_LOADING_PROGRESS,
  MAX_REPORTED_BUFFERED,
  MAX_REPORTED_TICK_MS,
  MAX_ROOM_ID_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_SEATS,
  MAX_SEED,
  MAX_SPEED,
  MAX_TRIBE_ID,
  MAX_WORLD_ID_LENGTH,
} from '../limits.js';
import type {
  ClientLoad,
  DepartedSeatMode,
  DepartureCause,
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
  asNonNegativeNumber,
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
const WEATHER_MODES = keysOf<WeatherMode>({ map: true, variable: true, winter: true });
export const VACANT_SEAT_MODES = keysOf<VacantSeatMode>({ ai: true, idle: true, absent: true });
export const DEPARTED_SEAT_MODES = keysOf<DepartedSeatMode>({ ai: true, idle: true });
export const DEPARTURE_CAUSES = keysOf<DepartureCause>({ vote: true, left: true });
export const AI_DIFFICULTIES = keysOf<AiDifficulty>({ easy: true, medium: true, hard: true });

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
    weather: raw.weather === null ? null : asOneOf(raw.weather, WEATHER_MODES, `${at}.weather`),
    alliedVision: raw.alliedVision === null ? null : asBoolean(raw.alliedVision, `${at}.alliedVision`),
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
    const mode = asOneOf(raw.mode, VACANT_SEAT_MODES, `${at}[${i}].mode`);
    const offers = parseSeatOffers(raw.offers, `${at}[${i}].offers`);
    if (!offers.includes(mode)) throw new Error(`${at}[${i}]: seat ${player} does not offer ${mode}`);
    return {
      player,
      mode,
      offers,
      color: asCount(raw.color, `${at}[${i}].color`),
      ...parseSeatTribes(raw, `${at}[${i}]`, false),
      ...parseSeatDifficulty(raw, `${at}[${i}]`),
    };
  });
}

/** A seat's authored and current tribe. A setup may leave the current one out, meaning the authored
 *  one; a view carries both or neither. Neither is allowed without an authored tribe. */
function parseSeatTribes(
  raw: Record<string, unknown>,
  at: string,
  paired: boolean,
): { readonly authoredTribe?: number; readonly tribe?: number } {
  if (raw.authoredTribe === undefined) {
    if (raw.tribe !== undefined)
      throw new Error(`${at}.tribe: a seat without an authored tribe has no choice`);
    return {};
  }
  const authoredTribe = parseTribe(raw.authoredTribe, `${at}.authoredTribe`);
  if (raw.tribe === undefined) {
    if (paired) throw new Error(`${at}.tribe: missing beside the authored tribe`);
    return { authoredTribe };
  }
  return { authoredTribe, tribe: parseTribe(raw.tribe, `${at}.tribe`) };
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

function parseSeatDifficulty(
  raw: Record<string, unknown>,
  at: string,
): { readonly difficulty?: AiDifficulty } {
  return raw.difficulty === undefined
    ? {}
    : { difficulty: asOneOf(raw.difficulty, AI_DIFFICULTIES, `${at}.difficulty`) };
}

function parseSeatOffers(value: unknown, at: string): readonly VacantSeatMode[] {
  const offers = asArray(value, at).map((mode, i) => asOneOf(mode, VACANT_SEAT_MODES, `${at}[${i}]`));
  if (offers.length === 0) throw new Error(`${at}: a seat offers at least one mode`);
  if (new Set(offers).size !== offers.length) throw new Error(`${at}: repeated mode`);
  return offers;
}

function parseRoomSeatView(value: unknown, at: string): RoomSeatView {
  const raw = asRecord(value, at);
  return {
    player: parseSeatIndex(raw.player, `${at}.player`),
    mode: asOneOf(raw.mode, SEAT_MODES, `${at}.mode`),
    offers: parseSeatOffers(raw.offers, `${at}.offers`),
    color: asCount(raw.color, `${at}.color`),
    ...parseSeatTribes(raw, at, true),
    ...parseSeatDifficulty(raw, at),
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
    load: raw.load === null ? null : parseClientLoad(raw.load, `${at}.load`),
    loading: raw.loading === null ? null : parseLoadingProgress(raw.loading, `${at}.loading`),
    roundTripMs: raw.roundTripMs === null ? null : asNonNegativeNumber(raw.roundTripMs, `${at}.roundTripMs`),
    delayTicks: raw.delayTicks === null ? null : asCount(raw.delayTicks, `${at}.delayTicks`),
    behindTicks: asCount(raw.behindTicks, `${at}.behindTicks`),
  };
}

export function parseLoadingProgress(value: unknown, at: string): number {
  return atMost(asCount(value, at), MAX_LOADING_PROGRESS, at);
}

export function parseClientLoad(value: unknown, at: string): ClientLoad {
  const raw = asRecord(value, at);
  return {
    tickMs: atMost(asNonNegativeNumber(raw.tickMs, `${at}.tickMs`), MAX_REPORTED_TICK_MS, `${at}.tickMs`),
    buffered: atMost(asCount(raw.buffered, `${at}.buffered`), MAX_REPORTED_BUFFERED, `${at}.buffered`),
  };
}

function atMost(value: number, max: number, at: string): number {
  if (value > max) throw new Error(`${at}: ${value} is above ${max}`);
  return value;
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

export function parseTribe(value: unknown, at: string): number {
  const tribe = asCount(value, at);
  if (tribe < 1 || tribe > MAX_TRIBE_ID)
    throw new Error(`${at}: tribe ${tribe} is outside 1..${MAX_TRIBE_ID}`);
  return tribe;
}

/** A saved start stands past tick 0, where a freshly built world would be indistinguishable. */
function parseInitialSave(value: unknown, at: string) {
  const raw = asRecord(value, at);
  const tick = asCount(raw.tick, `${at}.tick`);
  if (tick < 1) throw new Error(`${at}.tick: a save stands at tick 1 or later`);
  return { fingerprint: fingerprint(raw.fingerprint, `${at}.fingerprint`), tick };
}
