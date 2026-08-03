import type { FogModeName } from '../../../game/fog.js';
import type { MapPlayerSlot } from './roster-state.js';
import {
  authoredVacantMode,
  claimSeat,
  initialRosterState,
  type RosterState,
  rosterStartParams,
  type VacantMode,
} from './roster-state.js';

/**
 * Pure state for the lobby screen (design frame 4b) over the shared roster state: the slot rows
 * the list renders and the start-URL entry. DOM lives in `index.ts`.
 */

/** The engine's fog modes ({@link FogModeName} owns the vocabulary), in the segment's display
 *  order (labels in `mainMenu.lobby.fogModes`). */
export const LOBBY_FOG_MODES: readonly FogModeName[] = ['off', 'reveal', 'recon'];
export type LobbyFogMode = FogModeName;

/** Sticky-fog is the classic default a `?map=` launch without an explicit pick also falls back to
 *  (`targetSearch` reuses it). */
export const DEFAULT_FOG_MODE: LobbyFogMode = 'reveal';

export interface LobbyOptions {
  fog: LobbyFogMode;
  professionProgression: boolean;
}

/** Reads the lobby's game options from the menu URL, so a `?fog=`/`?progression=` launch or an
 *  earlier game's carried params pre-set the toggles. */
export function initialLobbyOptions(params: URLSearchParams): LobbyOptions {
  const fog = params.get('fog');
  return {
    fog: LOBBY_FOG_MODES.find((mode) => mode === fog) ?? DEFAULT_FOG_MODE,
    professionProgression: params.get('progression') !== 'off',
  };
}

/**
 * The design pre-seats the person (frame 4b shows them in slot 1), so a fresh lobby claims the
 * first claimable listed slot; sitting elsewhere stays one click. All-AI maps stay seatless.
 */
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
  /** What the seat does at start while vacant (drives the open row's sub and segment). */
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
 * The `?map=` entry the Start button navigates to: the map id, the roster choices
 * ({@link rosterStartParams}) and the explicit game options — explicit so they override any
 * stale carried `fog`/`progression` the menu URL still holds.
 */
export function lobbyStartEntry(
  mapId: string,
  state: RosterState,
  players: readonly MapPlayerSlot[],
  options: LobbyOptions,
): string {
  const params = new URLSearchParams({ map: mapId });
  for (const [key, value] of rosterStartParams(state, players)) params.set(key, value);
  params.set('fog', options.fog);
  params.set('progression', options.professionProgression ? 'on' : 'off');
  return `?${params.toString()}`;
}
