import { DEFAULT_LOCAL_PLAYER, type GameSession, orderedSeats } from '@open-northland/lockstep';
import { FOG_MODE_BY_NAME, type FogModeName } from '../../../game/fog.js';
import { onOffParam } from '../../../game/session-rules.js';
import {
  DEFAULT_SESSION_SEED,
  DEFAULT_SESSION_SPEED,
  type SessionRosterSlot,
  seatMode,
  sessionSearch,
} from '../../../game/session-url.js';
import { formatSearch } from '../../../view/params.js';
import { RULE_FOG_MODES as LOBBY_FOG_MODES } from '../lobby-controls/rules-state.js';
import type { MapPlayerSlot, SeatChoice } from './roster-state.js';
import {
  aiSeats,
  authoredVacantMode,
  claimSeat,
  initialRosterState,
  type RosterState,
  type VacantMode,
} from './roster-state.js';

export { RULE_FOG_MODES as LOBBY_FOG_MODES } from '../lobby-controls/rules-state.js';

/** Fallback fog mode for a `?map=` launch that carries no explicit pick. */
export const DEFAULT_FOG_MODE: FogModeName = 'reveal';

export interface LobbyOptions {
  fog: FogModeName;
  professionProgression: boolean;
  settlerNeeds: boolean;
}

/** Both rules default on, so only an explicit `off` in the URL clears the box. */
export function initialLobbyOptions(params: URLSearchParams): LobbyOptions {
  const fog = params.get('fog');
  return {
    fog: LOBBY_FOG_MODES.find((mode) => mode === fog) ?? DEFAULT_FOG_MODE,
    professionProgression: onOffParam(params, 'progression') !== false,
    settlerNeeds: onOffParam(params, 'needs') !== false,
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
    }));
}

/**
 * The session Start launches. Every rule is set rather than left to the world, so a stale carried param
 * cannot leak into the next map. A roster with no claimable seat starts seatless: nothing is claimed
 * and no offered seat auto-plays; the map's own computer seats play either way.
 */
export function lobbySession(
  mapId: string,
  state: RosterState,
  players: readonly MapPlayerSlot[],
  options: LobbyOptions,
): GameSession {
  const ai = new Set(state.seat === null ? [] : aiSeats(state, players));
  const localSeat = state.seat ?? DEFAULT_LOCAL_PLAYER;
  return {
    world: { kind: 'map', mapId },
    seed: DEFAULT_SESSION_SEED,
    seats: orderedSeats(
      lobbySeats(players, localSeat).map((slot) => ({
        player: slot.player,
        mode: seatMode(slot, localSeat, ai),
        color: state.colors.get(slot.player) ?? slot.colorId,
      })),
    ),
    localSeat,
    rules: {
      fog: FOG_MODE_BY_NAME[options.fog],
      progression: options.professionProgression,
      needs: options.settlerNeeds,
    },
    speed: DEFAULT_SESSION_SPEED,
  };
}

/** The listed slots plus the seat a seatless roster falls back to, which the launched game plays and
 *  the launch URL therefore has to carry. */
function lobbySeats(players: readonly MapPlayerSlot[], localSeat: SeatChoice): readonly SessionRosterSlot[] {
  if (typeof localSeat !== 'number' || players.some((slot) => slot.player === localSeat)) return players;
  return [...players, { player: localSeat, colorId: localSeat, type: 'human', claimable: true }];
}

/** The `?map=` entry Start navigates to: {@link lobbySession} as a URL. */
export function lobbyStartEntry(
  mapId: string,
  state: RosterState,
  players: readonly MapPlayerSlot[],
  options: LobbyOptions,
): string {
  return formatSearch(sessionSearch(lobbySession(mapId, state, players, options), players));
}
