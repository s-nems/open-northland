import { MAP_PLAYER_COLOR_COUNT } from '@open-northland/data';
import {
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
import { aiSeatsParam, floatParam, intParam } from '../view/params.js';
import { fogModeName } from './fog.js';
import { sessionRuleOverrides } from './session-rules.js';

/**
 * The URL adapter for a session: a `?map=` or `?scene=` search parses into a {@link GameSession}, and
 * the menu serializes one back, so an entry assembles its world from the descriptor rather than from
 * the search.
 */

const { isValidPlayer } = components;

/** The seed a session runs on when nothing names one; a networked session carries its own. */
export const DEFAULT_SESSION_SEED = 7;

/** The wall-clock multiplier a session starts at when `?speed=` names none. */
export const DEFAULT_SESSION_SPEED = 1;

/** The seat rows an entry knows before a world exists: a map script's roster, or the lobby's
 *  `/maps-index` rows. */
export interface SessionRosterSlot {
  readonly player: number;
  readonly colorId: number;
}

/** `?map=<id>`; null when the search names none, which draws the fallback strip instead of a map. */
export function mapIdParam(params: URLSearchParams): string | null {
  return params.get('map');
}

/** The session a `?map=` search describes. The roster supplies each seat's authored colour, which
 *  `?colors=` then overrides. */
export function mapSession(params: URLSearchParams, roster: readonly SessionRosterSlot[]): GameSession {
  const localSeat = localSeatParam(params);
  return {
    world: { kind: 'map', mapId: mapIdParam(params) ?? '' },
    seed: intParam(params, 'seed', DEFAULT_SESSION_SEED),
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
    const ai = session.seats.filter((seat) => seat.mode === 'ai').map((seat) => seat.player);
    if (ai.length > 0) params.set('ai', ai.join(','));
    // Only a map takes its seed from the search; a scene's is its own, so writing one would lie.
    if (session.seed !== DEFAULT_SESSION_SEED) params.set('seed', String(session.seed));
  }
  const fog = session.rules.fog === null ? null : fogModeName(session.rules.fog);
  if (fog !== null) params.set('fog', fog);
  if (session.rules.progression !== null) {
    params.set('progression', session.rules.progression ? 'on' : 'off');
  }
  if (session.rules.needs !== null) params.set('needs', session.rules.needs ? 'on' : 'off');
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
 * A map that ships no roster still runs the `?ai=` seats it was asked for, which the roster rows alone
 * would drop.
 */
function rosterSeats(
  params: URLSearchParams,
  roster: readonly SessionRosterSlot[],
  localSeat: LocalSeat,
): readonly SessionSeat[] {
  const overrides = colorOverridesParam(params);
  const ai = new Set(aiSeatsParam(params).filter(isValidPlayer));
  const authored = new Map(roster.map((slot) => [slot.player, slot.colorId]));
  const players = new Set([...authored.keys(), ...ai, ...overrides.keys()]);
  if (typeof localSeat === 'number') players.add(localSeat);
  return orderedSeats(
    [...players].map((player) => ({
      player,
      mode: seatMode(player, localSeat, ai),
      // A seat the map never authored keeps its slot id as its colour, the roster-less default.
      color: overrides.get(player) ?? authored.get(player) ?? player,
    })),
  );
}

/** The claimed seat is played by the person even when `?ai=` also lists it: one seat cannot be both. */
export function seatMode(player: number, localSeat: LocalSeat, ai: ReadonlySet<number>): SeatMode {
  if (player === localSeat) return 'human';
  return ai.has(player) ? 'ai' : 'idle';
}

/** `?colors=<slot>:<colorId>,…`, dropping malformed pairs. Colours are bounded to the roster's id
 *  space, because an out-of-range id renders differently per consumer. */
function colorOverridesParam(params: URLSearchParams): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  const raw = params.get('colors');
  if (raw === null) return out;
  for (const pair of raw.split(',')) {
    const [slotRaw, colorRaw] = pair.split(':');
    const slot = Number.parseInt(slotRaw ?? '', 10);
    const color = Number.parseInt(colorRaw ?? '', 10);
    if (isValidPlayer(slot) && Number.isInteger(color) && color >= 0 && color < MAP_PLAYER_COLOR_COUNT) {
      out.set(slot, color);
    }
  }
  return out;
}
