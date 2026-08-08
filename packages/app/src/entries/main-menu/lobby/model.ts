import type { FogModeName } from '../../../game/fog.js';
import { onOffParam } from '../../../game/session-rules.js';
import type { MapPlayerSlot } from './roster-state.js';
import {
  authoredVacantMode,
  claimSeat,
  initialRosterState,
  type RosterState,
  rosterStartParams,
  type VacantMode,
} from './roster-state.js';

/** The fog modes in the segment's display order. */
export const LOBBY_FOG_MODES: readonly FogModeName[] = ['off', 'reveal', 'recon'];

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

/** The `?map=` entry Start navigates to; every option is written explicitly so it overrides a stale
 *  carried param. */
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
  params.set('needs', options.settlerNeeds ? 'on' : 'off');
  return `?${params.toString()}`;
}
