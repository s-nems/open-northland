import type {
  ComputerDifficulty,
  DayNightMode,
  PeaceMinutes,
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
  PEACE_MINUTES,
} from '../limits.js';
import type {
  CatalogMapAnnouncement,
  ClientLoad,
  DepartedSeatMode,
  DepartureCause,
  LobbySettings,
  RoomMapOrigin,
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
import { assertNever, parseFlag, parseLine, parseNick } from './text.js';

const ROOM_STATES = ['lobby', 'running', 'ended'] as const satisfies readonly RoomState[];

const SEAT_MODES = keysOf<SeatMode>({
  human: true,
  'map-ai': true,
  computer: true,
  idle: true,
  absent: true,
});
const WEATHER_MODES = keysOf<WeatherMode>({ map: true, variable: true, winter: true, off: true });
const DAY_NIGHT_MODES = keysOf<DayNightMode>({ map: true, on: true, off: true });
export const VACANT_SEAT_MODES = keysOf<VacantSeatMode>({
  'map-ai': true,
  computer: true,
  idle: true,
  absent: true,
});
export const DEPARTED_SEAT_MODES = keysOf<DepartedSeatMode>({ computer: true, idle: true });
export const DEPARTURE_CAUSES = keysOf<DepartureCause>({ vote: true, left: true, loadingTimedOut: true });
export const COMPUTER_DIFFICULTIES = keysOf<ComputerDifficulty>({ easy: true, medium: true, hard: true });

export function parseRoomSettings(value: unknown, at: string): RoomSettings {
  const raw = asRecord(value, at);
  return {
    ...parseLobbySettings(raw, at),
    world: parseSessionWorld(raw.world, `${at}.world`),
    ...(raw.initialSave === undefined
      ? {}
      : { initialSave: parseInitialSave(raw.initialSave, `${at}.initialSave`) }),
    ...parseMapDelivery(raw, at),
  };
}

const MAP_ORIGINS = keysOf<RoomMapOrigin>({ mod: true, user: true, catalog: true });
/** A catalogue entry or map id: one plain ASCII token, the same rule the clients name map files by. */
const CATALOG_ID = /^[a-z0-9_-]{1,128}$/i;

function catalogId(value: unknown, at: string): string {
  if (typeof value !== 'string' || !CATALOG_ID.test(value)) throw new Error(`${at}: expected a catalogue id`);
  return value;
}

/** `mapOrigin` and `catalogMap` together: a catalogue origin names its map, and only it does. */
function parseMapDelivery(
  raw: Record<string, unknown>,
  at: string,
): Pick<RoomSettings, 'mapOrigin' | 'catalogMap'> {
  if (raw.mapOrigin === undefined) {
    if (raw.catalogMap !== undefined) throw new Error(`${at}.catalogMap: requires mapOrigin catalog`);
    return {};
  }
  const mapOrigin = asOneOf(raw.mapOrigin, MAP_ORIGINS, `${at}.mapOrigin`);
  if (mapOrigin !== 'catalog') {
    if (raw.catalogMap !== undefined) throw new Error(`${at}.catalogMap: requires mapOrigin catalog`);
    return { mapOrigin };
  }
  const map = asRecord(raw.catalogMap, `${at}.catalogMap`);
  const catalogMap: CatalogMapAnnouncement = {
    entryId: catalogId(map.entryId, `${at}.catalogMap.entryId`),
    mapId: catalogId(map.mapId, `${at}.catalogMap.mapId`),
    fingerprint: fingerprint(map.fingerprint, `${at}.catalogMap.fingerprint`),
    irVersion: asCount(map.irVersion, `${at}.catalogMap.irVersion`),
  };
  if (catalogMap.irVersion < 1) throw new Error(`${at}.catalogMap.irVersion: expected a positive version`);
  const world = asRecord(raw.world, `${at}.world`);
  if (world.kind !== 'map' || world.mapId !== catalogMap.mapId)
    throw new Error(`${at}.catalogMap.mapId: does not name the room's map`);
  return { mapOrigin, catalogMap };
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
    case 'map': {
      const mapId = parseLine(raw.mapId, `${at}.mapId`, MAX_WORLD_ID_LENGTH);
      if (raw.variant === undefined) return { kind, mapId };
      return { kind, mapId, variant: parseLine(raw.variant, `${at}.variant`, MAX_WORLD_ID_LENGTH) };
    }
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
    dayNight: raw.dayNight === null ? null : asOneOf(raw.dayNight, DAY_NIGHT_MODES, `${at}.dayNight`),
    alliedVision: raw.alliedVision === null ? null : asBoolean(raw.alliedVision, `${at}.alliedVision`),
    peace: raw.peace === null ? null : parsePeace(raw.peace, `${at}.peace`),
  };
}

function parsePeace(value: unknown, at: string): PeaceMinutes {
  const minutes = PEACE_MINUTES.find((known) => known === value);
  if (minutes === undefined) throw new Error(`${at}: ${String(value)} is not a peace length`);
  return minutes;
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
    const claimable = asBoolean(raw.claimable, `${at}[${i}].claimable`);
    validateSeatControl(mode, claimable, offers, `${at}[${i}]`);
    if (!offers.includes(mode)) throw new Error(`${at}[${i}]: seat ${player} does not offer ${mode}`);
    return {
      player,
      mode,
      offers,
      claimable,
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
): { readonly difficulty?: ComputerDifficulty } {
  return raw.difficulty === undefined
    ? {}
    : { difficulty: asOneOf(raw.difficulty, COMPUTER_DIFFICULTIES, `${at}.difficulty`) };
}

function parseSeatOffers(value: unknown, at: string): readonly VacantSeatMode[] {
  const offers = asArray(value, at).map((mode, i) => asOneOf(mode, VACANT_SEAT_MODES, `${at}[${i}]`));
  if (offers.length === 0) throw new Error(`${at}: a seat offers at least one mode`);
  if (new Set(offers).size !== offers.length) throw new Error(`${at}: repeated mode`);
  return offers;
}

function validateSeatControl(
  mode: RoomSeatView['mode'],
  claimable: boolean,
  offers: readonly VacantSeatMode[],
  at: string,
): void {
  if (offers.includes('map-ai') && (claimable || offers.length !== 1)) {
    throw new Error(`${at}: map-ai is reserved and cannot offer another mode`);
  }
  if (mode === 'human') {
    if (!claimable) throw new Error(`${at}: a reserved seat cannot be human`);
  }
  if ((mode === 'map-ai') !== offers.includes('map-ai')) {
    throw new Error(`${at}: map-ai control must stay on its reserved seat`);
  }
}

function parseRoomSeatView(value: unknown, at: string): RoomSeatView {
  const raw = asRecord(value, at);
  const mode = asOneOf(raw.mode, SEAT_MODES, `${at}.mode`);
  const claimable = asBoolean(raw.claimable, `${at}.claimable`);
  const offers = parseSeatOffers(raw.offers, `${at}.offers`);
  validateSeatControl(mode, claimable, offers, at);
  return {
    player: parseSeatIndex(raw.player, `${at}.player`),
    mode,
    claimable,
    offers,
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
    ...parseFlag(raw, `${at}.flag`),
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
    members: asArray(raw.members, `${at}.members`).map((nick, i) => parseNick(nick, `${at}.members[${i}]`)),
    seats: asCount(raw.seats, `${at}.seats`),
    world: parseSessionWorld(raw.world, `${at}.world`),
    playedMs: raw.playedMs === null ? null : asNonNegativeNumber(raw.playedMs, `${at}.playedMs`),
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
