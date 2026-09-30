import {
  type AiDifficulty,
  DEFAULT_LOCAL_PLAYER,
  DEFAULT_WEATHER_MODE,
  type GameSession,
  orderedSeats,
  type SessionSeat,
  type WeatherMode,
} from '@open-northland/lockstep';
import { FOG_MODE_BY_NAME, type FogModeName } from '../../../game/fog.js';
import { onOffParam, weatherModeParam } from '../../../game/session-rules.js';
import { DEFAULT_SESSION_SPEED, seatMode, sessionSearch } from '../../../game/session-url.js';
import { formatSearch } from '../../../view/params.js';
import {
  absentSeats,
  aiSeats,
  authoredVacantMode,
  claimSeat,
  initialRosterState,
  type MapPlayerSlot,
  offersDifficulty,
  offersTribeChoice,
  type RosterState,
  slotDifficulty,
  type VacantMode,
} from './roster-state.js';

/** The fog modes a lobby offers: its map setting times fog of war. `off` stays a debug-menu pick. */
export type LobbyFogModeName = Exclude<FogModeName, 'off'>;

export const LOBBY_FOG_MODES: readonly LobbyFogModeName[] = ['classic', 'classic-fow', 'recon', 'recon-fow'];

/** Fallback fog mode for a `?map=` launch that carries no explicit pick: the original's classic map
 *  without fog of war. */
export const DEFAULT_FOG_MODE: LobbyFogModeName = 'classic';

export interface LobbyOptions {
  fog: LobbyFogModeName;
  professionProgression: boolean;
  settlerNeeds: boolean;
  weather: WeatherMode;
}

/** Both rules default on, so only an explicit `off` in the URL clears the box. */
export function initialLobbyOptions(params: URLSearchParams): LobbyOptions {
  const fog = params.get('fog');
  return {
    fog: LOBBY_FOG_MODES.find((mode) => mode === fog) ?? DEFAULT_FOG_MODE,
    professionProgression: onOffParam(params, 'progression') !== false,
    settlerNeeds: onOffParam(params, 'needs') !== false,
    weather: weatherModeParam(params) ?? DEFAULT_WEATHER_MODE,
  };
}

/** A fresh lobby pre-seats the player in the first claimable listed slot; all-AI maps stay seatless. */
export function initialLobbyState(players: readonly MapPlayerSlot[]): RosterState {
  const state = initialRosterState(players);
  const first = players.find((slot) => slot.claimable && !slot.hidden);
  return first === undefined ? state : claimSeat(state, first.player);
}

export interface LobbySlotRow {
  readonly slot: MapPlayerSlot;
  /** Current team colour (the person's pick, else authored). */
  readonly colorId: number;
  /** `yours` = the claimed seat, `scenario` = script-driven and locked, `open` = claimable. */
  readonly kind: 'yours' | 'scenario' | 'open';
  /** What the seat does at start while vacant. */
  readonly vacantMode: VacantMode;
  /** Current civilization (the person's pick, else authored). */
  readonly tribe: number;
  /** False for a monster seat, which keeps its own tribe. */
  readonly offersTribe: boolean;
  /** How hard the seat plays; null while no computer plays it, or for a monster seat, which runs no
   *  strategic AI. */
  readonly difficulty: AiDifficulty | null;
}

/** The listed slot rows in authored order; hidden slots never render. */
export function lobbySlotRows(
  players: readonly MapPlayerSlot[],
  state: RosterState,
): readonly LobbySlotRow[] {
  return players
    .filter((slot) => !slot.hidden)
    .map((slot) => ({
      slot,
      colorId: state.colors.get(slot.player) ?? slot.colorId,
      kind: slot.player === state.seat ? 'yours' : slot.claimable ? 'open' : 'scenario',
      vacantMode: state.vacantModes.get(slot.player) ?? authoredVacantMode(slot),
      tribe: state.tribes.get(slot.player) ?? slot.tribeId,
      offersTribe: offersTribeChoice(slot),
      difficulty: playsAtDifficulty(slot, state) ? slotDifficulty(state, slot.player) : null,
    }));
}

/** Whether the lobby hands `slot` to the computer at a level. */
function playsAtDifficulty(slot: MapPlayerSlot, state: RosterState): boolean {
  return state.seat !== null && offersDifficulty(slot) && aiSeats(state, [slot]).length > 0;
}

/**
 * The session Start launches. Every rule is set rather than left to the world, so a stale carried param
 * cannot leak into the next map. A roster with no claimable seat starts seatless: nothing is claimed
 * and no offered seat auto-plays or leaves the map; the map's own computer seats play either way.
 */
export function lobbySession(
  mapId: string,
  state: RosterState,
  players: readonly MapPlayerSlot[],
  options: LobbyOptions,
  seed: number,
): GameSession {
  const lists = {
    ai: new Set(state.seat === null ? [] : aiSeats(state, players)),
    absent: new Set(state.seat === null ? [] : absentSeats(state, players)),
  };
  const localSeat = state.seat ?? DEFAULT_LOCAL_PLAYER;
  const seats: SessionSeat[] = players.map((slot) => {
    const tribe = state.tribes.get(slot.player);
    const retribed = tribe !== undefined && tribe !== slot.tribeId && offersTribeChoice(slot);
    const mode = seatMode(slot, localSeat, lists);
    const difficulty =
      lists.ai.has(slot.player) && offersDifficulty(slot) ? slotDifficulty(state, slot.player) : undefined;
    return {
      player: slot.player,
      mode,
      color: state.colors.get(slot.player) ?? slot.colorId,
      ...(retribed ? { tribe } : {}),
      ...(difficulty === undefined ? {} : { difficulty }),
    };
  });
  // A seatless roster falls back to a seat the map may not list; the launched game plays it, so the
  // launch URL has to carry it. It keeps its slot id as its colour.
  if (typeof localSeat === 'number' && !players.some((slot) => slot.player === localSeat)) {
    seats.push({ player: localSeat, mode: 'human', color: localSeat });
  }
  return {
    world: { kind: 'map', mapId },
    seed,
    seats: orderedSeats(seats),
    localSeat,
    rules: {
      fog: FOG_MODE_BY_NAME[options.fog],
      progression: options.professionProgression,
      needs: options.settlerNeeds,
      weather: options.weather,
    },
    speed: DEFAULT_SESSION_SPEED,
  };
}

/** The `?map=` entry Start navigates to: {@link lobbySession} as a URL. */
export function lobbyStartEntry(
  mapId: string,
  state: RosterState,
  players: readonly MapPlayerSlot[],
  options: LobbyOptions,
  seed: number,
): string {
  return formatSearch(sessionSearch(lobbySession(mapId, state, players, options, seed), players));
}
