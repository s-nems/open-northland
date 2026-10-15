import { isCivilizationTribe, MAP_PLAYER_COLOR_COUNT, type MapsIndexPlayerSlot } from '@open-northland/data';
import {
  type ComputerDifficulty,
  DEFAULT_LOCAL_PLAYER,
  type GameSession,
  type LocalSeat,
  OBSERVER_SEAT,
  OVERSEER_SEAT,
  orderedSeats,
  type SeatMode,
  type SessionSeat,
} from '@open-northland/lockstep';
import { components } from '@open-northland/sim';
import { floatParam, HUMAN_TRIBE_PARAM, intParam, seatListParam } from '../view/params.js';
import { fogModeName } from './fog.js';
import { sessionRuleOverrides } from './session-rules.js';

/**
 * The URL adapter for a session: a `?map=` or `?scene=` search parses into a {@link GameSession}, and
 * the menu serializes one back, so an entry assembles its world from the descriptor rather than from
 * the search.
 */

const { isValidPlayer } = components;

const SEED_VALUES = 2 ** 32;

/** A new match's seed, drawn outside the sim: each match plays another world and another weather. */
export const drawSessionSeed = (): number => Math.floor(Math.random() * SEED_VALUES);

const NO_SEED = -1;
const NO_TRIBE = -1;

/** `?seed=<n>`: the seed that replays a match; null when the search names none. */
export function seedParam(params: URLSearchParams): number | null {
  const seed = intParam(params, 'seed', NO_SEED);
  return seed === NO_SEED || seed >= SEED_VALUES ? null : seed;
}

/** The wall-clock multiplier a session starts at when `?speed=` names none. */
export const DEFAULT_SESSION_SPEED = 1;

/** The seat rows an entry knows before a world exists: a map script's roster read against its
 *  `[multiplayer]` table (`mapLobbySlots`), or the lobby's `maps-index.json` rows. */
export type SessionRosterSlot = Pick<
  MapsIndexPlayerSlot,
  'player' | 'colorId' | 'tribeId' | 'type' | 'claimable'
> &
  Partial<Pick<MapsIndexPlayerSlot, 'aiAllowed' | 'noneAllowed' | 'hidden'>>;

/** An authored computer seat the map never offers to a person; lobby mode choices cannot retype it. */
export function isReservedMapAiSeat(
  slot: Pick<SessionRosterSlot, 'type' | 'claimable' | 'aiAllowed'>,
): boolean {
  return slot.type !== 'none' && !slot.claimable && slot.aiAllowed !== false;
}

/** A reserved or hidden slot cannot grant local player authority through a launch URL or stale selection. */
export function claimableLocalSeat(requested: LocalSeat, roster: readonly SessionRosterSlot[]): LocalSeat {
  const slot = roster.find((slot) => slot.player === requested);
  return slot !== undefined && (!slot.claimable || slot.hidden === true) ? OBSERVER_SEAT : requested;
}

/** `?map=<id>`; null when the search names none, which draws the fallback strip instead of a map. */
export function mapIdParam(params: URLSearchParams): string | null {
  return params.get('map');
}

/** The session a `?map=` search describes. The roster supplies each seat's authored colour, which
 *  `?colors=` then overrides; `?tribes=` names the seats played as another civilization, `?tribe=`
 *  the person's own seat's civilization unless `?tribes=` names that seat, and `?difficulty=` how
 *  hard each computer seat plays. A search naming no seed draws one. */
export function mapSession(params: URLSearchParams, roster: readonly SessionRosterSlot[]): GameSession {
  const localSeat = claimableLocalSeat(localSeatParam(params), roster);
  return {
    world: { kind: 'map', mapId: mapIdParam(params) ?? '' },
    seed: seedParam(params) ?? drawSessionSeed(),
    seats: rosterSeats(params, roster, localSeat),
    localSeat,
    rules: sessionRuleOverrides(params),
    speed: floatParam(params, 'speed', DEFAULT_SESSION_SPEED),
  };
}

/** The session a `?scene=` search describes. A scene authors its own roster and seed, so the search
 *  only carries the rule overrides and the tempo. */
export function sceneSession(params: URLSearchParams, sceneId: string, seed: number): GameSession {
  return {
    world: { kind: 'scene', sceneId },
    seed,
    seats: [],
    localSeat: DEFAULT_LOCAL_PLAYER,
    rules: sessionRuleOverrides(params),
    speed: floatParam(params, 'speed', DEFAULT_SESSION_SPEED),
  };
}

/**
 * The search that launches `session`. A value equal to what an absent param parses to is left out, so
 * a menu launch carries the choices a person made and nothing else; `player` is always written,
 * because the roster it names is the point of the launch. Round-trips through {@link mapSession}.
 */
export function sessionSearch(
  session: GameSession,
  roster: readonly SessionRosterSlot[] = [],
): URLSearchParams {
  const params = new URLSearchParams();
  if (session.world.kind === 'scene') {
    params.set('scene', session.world.sceneId);
  } else {
    if (session.world.mapId !== '') params.set('map', session.world.mapId);
    params.set('player', String(session.localSeat));
    const authored = new Map(roster.map((slot) => [slot.player, slot.colorId]));
    const recoloured = session.seats
      .filter((seat) => seat.color !== (authored.get(seat.player) ?? seat.player))
      .map((seat) => `${seat.player}:${seat.color}`);
    if (recoloured.length > 0) params.set('colors', recoloured.join(','));
    const authoredTribe = new Map(roster.map((slot) => [slot.player, slot.tribeId]));
    const retribed = session.seats.flatMap((seat) =>
      seat.tribe === undefined || seat.tribe === authoredTribe.get(seat.player)
        ? []
        : [`${seat.player}:${seat.tribe}`],
    );
    if (retribed.length > 0) params.set('tribes', retribed.join(','));
    const levels = session.seats.flatMap((seat) =>
      seat.difficulty === undefined ? [] : [`${seat.player}:${seat.difficulty}`],
    );
    if (levels.length > 0) params.set('difficulty', levels.join(','));
    // The map's own computer seats play without being named, so `?computer=` lists the person's choices only.
    const reservedMapAi = new Set(roster.filter(isReservedMapAiSeat).map((slot) => slot.player));
    const computer = session.seats
      .filter((seat) => seat.mode === 'computer' && !reservedMapAi.has(seat.player))
      .map((seat) => seat.player);
    if (computer.length > 0) params.set('computer', computer.join(','));
    const idle = session.seats
      .filter((seat) => {
        const slot = roster.find((slot) => slot.player === seat.player);
        return (
          seat.mode === 'idle' &&
          slot?.type === 'ai' &&
          slot.aiAllowed !== false &&
          !reservedMapAi.has(seat.player)
        );
      })
      .map((seat) => seat.player);
    if (idle.length > 0) params.set('idle', idle.join(','));
    const absent = session.seats.filter((seat) => seat.mode === 'absent').map((seat) => seat.player);
    if (absent.length > 0) params.set('absent', absent.join(','));
    // Only a map takes its seed from the search; a scene's is its own, so writing one would lie.
    params.set('seed', String(session.seed));
  }
  const fog = session.rules.fog === null ? null : fogModeName(session.rules.fog);
  if (fog !== null) params.set('fog', fog);
  if (session.rules.progression !== null) {
    params.set('progression', session.rules.progression ? 'on' : 'off');
  }
  if (session.rules.needs !== null) params.set('needs', session.rules.needs ? 'on' : 'off');
  if (session.rules.weather !== null) params.set('weathermode', session.rules.weather);
  if (session.rules.alliedVision !== null)
    params.set('alliedvision', session.rules.alliedVision ? 'on' : 'off');
  if (session.speed !== DEFAULT_SESSION_SPEED) params.set('speed', String(session.speed));
  return params;
}

/** `?player=N|observer|overseer`; an unusable value falls back to the default seat. */
function localSeatParam(params: URLSearchParams): LocalSeat {
  const raw = params.get('player');
  if (raw === OBSERVER_SEAT || raw === OVERSEER_SEAT) return raw;
  if (raw === null) return DEFAULT_LOCAL_PLAYER;
  const seat = Number.parseInt(raw, 10);
  return isValidPlayer(seat) ? seat : DEFAULT_LOCAL_PLAYER;
}

/**
 * Every seat the search puts in play: the map's roster rows, plus any seat the search names on its own.
 * A map that ships no roster still runs the `?computer=` seats it was asked for, which the roster rows alone
 * would drop.
 */
function rosterSeats(
  params: URLSearchParams,
  roster: readonly SessionRosterSlot[],
  localSeat: LocalSeat,
): readonly SessionSeat[] {
  const overrides = colorOverridesParam(params);
  const tribes = seatPairsParam(params, 'tribes', (tribe) => tribe > 0);
  const humanTribe = humanTribeParam(params);
  const difficulties = seatDifficultiesParam(params);
  const lists: SeatLists = {
    computer: new Set(seatListParam(params, 'computer').filter(isValidPlayer)),
    idle: new Set(seatListParam(params, 'idle').filter(isValidPlayer)),
    absent: new Set(seatListParam(params, 'absent').filter(isValidPlayer)),
  };
  const authored = new Map(roster.map((slot) => [slot.player, slot]));
  const players = new Set([...authored.keys(), ...lists.computer, ...lists.idle, ...overrides.keys()]);
  if (typeof localSeat === 'number') players.add(localSeat);
  return orderedSeats(
    [...players].map((player) => {
      // A seat the map never authored is a claimable one that keeps its slot id as its colour.
      const slot = authored.get(player) ?? { player, colorId: player, type: 'human', claimable: true };
      const mode = seatMode(slot, localSeat, lists);
      const tribe = tribes.get(player) ?? (mode === 'human' ? humanTribe : undefined);
      // Only a computer seat plays at a difficulty; a stale pair for another seat is dropped.
      const difficulty = mode === 'computer' || mode === 'map-ai' ? difficulties.get(player) : undefined;
      return {
        player,
        mode,
        color: overrides.get(player) ?? slot.colorId,
        ...(tribe === undefined ? {} : { tribe }),
        ...(difficulty === undefined ? {} : { difficulty }),
      };
    }),
  );
}

/** Explicit seat-control overrides carried by the launch URL. */
export interface SeatLists {
  readonly computer: ReadonlySet<number>;
  readonly idle: ReadonlySet<number>;
  readonly absent: ReadonlySet<number>;
}

/** Closed authored seats never participate. A human claim wins over mode lists; locked computer
 *  seats follow the map. An unclaimed selectable computer seat defaults to Computer. */
export function seatMode(
  slot: Pick<SessionRosterSlot, 'player' | 'type' | 'claimable' | 'aiAllowed' | 'noneAllowed'>,
  localSeat: LocalSeat,
  lists: SeatLists,
): SeatMode {
  if (slot.type === 'none') return 'absent';
  if (isReservedMapAiSeat(slot)) return 'map-ai';
  if (slot.player === localSeat) return 'human';
  if (slot.aiAllowed !== false && lists.computer.has(slot.player)) return 'computer';
  if (lists.idle.has(slot.player)) return 'idle';
  if (slot.noneAllowed !== false && lists.absent.has(slot.player)) return 'absent';
  return slot.type === 'ai' && slot.aiAllowed !== false ? 'computer' : 'idle';
}

/** `?tribe=<id>`: the civilization the person's seat plays, whatever seat that is; map AIs keep theirs. */
function humanTribeParam(params: URLSearchParams): number | undefined {
  const tribe = intParam(params, HUMAN_TRIBE_PARAM, NO_TRIBE);
  return isCivilizationTribe(tribe) ? tribe : undefined;
}

/** `?colors=<slot>:<colorId>,…`. Colours are bounded to the roster's id space, because an
 *  out-of-range id renders differently per consumer. */
function colorOverridesParam(params: URLSearchParams): ReadonlyMap<number, number> {
  return seatPairsParam(params, 'colors', (color) => color >= 0 && color < MAP_PLAYER_COLOR_COUNT);
}

/** `?difficulty=slot:level,...`: how hard each named computer seat plays. */
function seatDifficultiesParam(params: URLSearchParams): ReadonlyMap<number, ComputerDifficulty> {
  const out = new Map<number, ComputerDifficulty>();
  for (const pair of (params.get('difficulty') ?? '').split(',')) {
    const [slotRaw, level] = pair.split(':');
    const slot = Number.parseInt(slotRaw ?? '', 10);
    const difficulty = components.COMPUTER_DIFFICULTIES.find((known) => known === level);
    if (isValidPlayer(slot) && difficulty !== undefined) out.set(slot, difficulty);
  }
  return out;
}

/** A `<slot>:<value>,…` list, dropping malformed pairs and values `valid` refuses. */
function seatPairsParam(
  params: URLSearchParams,
  key: string,
  valid: (value: number) => boolean,
): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  const raw = params.get(key);
  if (raw === null) return out;
  for (const pair of raw.split(',')) {
    const [slotRaw, valueRaw] = pair.split(':');
    const slot = Number.parseInt(slotRaw ?? '', 10);
    const value = Number.parseInt(valueRaw ?? '', 10);
    if (isValidPlayer(slot) && Number.isInteger(value) && valid(value)) out.set(slot, value);
  }
  return out;
}
