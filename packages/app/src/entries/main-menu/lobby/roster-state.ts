import type { MapsIndexPlayerSlot } from '@open-northland/content-resolver/wire';

/**
 * Pure roster state behind the lobby screen: seats, colours and vacant modes over the slots
 * `/maps-index` serves. No DOM, so it is unit-tested headlessly.
 */

/** One map player slot as `/maps-index` serves it. */
export type MapPlayerSlot = MapsIndexPlayerSlot;

/** What a free claimable seat does once the game starts: nothing, or the strategic AI plays it. */
export type VacantMode = 'idle' | 'ai';

/** `?player=observer`: watch and inspect the match without controlling a slot or issuing a command. */
export const OBSERVER_SEAT = 'observer';

/** `?player=overseer`: the observer's whole-map view, but commanding every seat. */
export const OVERSEER_SEAT = 'overseer';

export type SeatChoice = number | typeof OBSERVER_SEAT | typeof OVERSEER_SEAT;

/** An `ai` slot auto-plays when the lobby allows AI at all; a `human` one idles. */
export function authoredVacantMode(slot: MapPlayerSlot): VacantMode {
  return slot.type === 'ai' && slot.aiAllowed ? 'ai' : 'idle';
}

/** False for an all-AI roster, where the menu must not gate Start on a seat that cannot exist. */
export function hasClaimableSeat(players: readonly MapPlayerSlot[]): boolean {
  return players.some((p) => p.claimable && !p.hidden);
}

/** The person's choices over one map's roster. */
export interface RosterState {
  /** Null while no seat is taken, which keeps Start gated. */
  readonly seat: SeatChoice | null;
  /** Current colour per slot id, initialised from the map's authored colours. */
  readonly colors: ReadonlyMap<number, number>;
  /** Per-slot vacant mode, initialised from the authored type. */
  readonly vacantModes: ReadonlyMap<number, VacantMode>;
}

export function initialRosterState(players: readonly MapPlayerSlot[]): RosterState {
  return {
    seat: null,
    colors: new Map(players.map((p) => [p.player, p.colorId])),
    vacantModes: new Map(players.map((p) => [p.player, authoredVacantMode(p)])),
  };
}

/** Claims a seat (a re-claim moves it); the vacated slot keeps its remembered vacant mode. */
export function claimSeat(state: RosterState, slot: SeatChoice): RosterState {
  return { ...state, seat: slot };
}

export function toggleVacantMode(state: RosterState, slot: number): RosterState {
  const vacantModes = new Map(state.vacantModes);
  vacantModes.set(slot, vacantModes.get(slot) === 'ai' ? 'idle' : 'ai');
  return { ...state, vacantModes };
}

/** Real maps author duplicate colours freely, so "worn" is always relative to the asking slot. */
export function wornByAnother(state: RosterState, slot: number, colorId: number): boolean {
  for (const [other, c] of state.colors) if (other !== slot && c === colorId) return true;
  return false;
}

/**
 * A colour another slot already wears is rejected with `null`; re-picking the slot's own colour is
 * accepted, so authored duplicates survive but new ones cannot be created.
 */
export function setSlotColor(state: RosterState, slot: number, colorId: number): RosterState | null {
  if (state.colors.get(slot) !== colorId && wornByAnother(state, slot, colorId)) return null;
  const colors = new Map(state.colors);
  colors.set(slot, colorId);
  return { ...state, colors };
}

/** A slot's effective mode is the toggle's when set, else the authored default. */
export function aiSeats(state: RosterState, players: readonly MapPlayerSlot[]): number[] {
  return players
    .filter(
      (p) =>
        p.claimable &&
        p.aiAllowed &&
        !p.hidden &&
        p.player !== state.seat &&
        (state.vacantModes.get(p.player) ?? authoredVacantMode(p)) === 'ai',
    )
    .map((p) => p.player);
}

/**
 * The start-URL params for the roster choices. `colors=<slot>:<colorId>,…` carries only slots
 * recoloured away from the authored colour, while `ai=<slot>,…` carries the full seat list, because
 * the `?map=` entry consumes it with no roster knowledge of its own. Empty until a seat is claimed.
 */
export function rosterStartParams(
  state: RosterState,
  players: readonly MapPlayerSlot[],
): readonly (readonly [string, string])[] {
  if (state.seat === null) return [];
  const params: (readonly [string, string])[] = [['player', String(state.seat)]];
  const recoloured = players
    .filter((p) => state.colors.get(p.player) !== undefined && state.colors.get(p.player) !== p.colorId)
    .map((p) => `${p.player}:${state.colors.get(p.player)}`);
  if (recoloured.length > 0) params.push(['colors', recoloured.join(',')]);
  const ai = aiSeats(state, players);
  if (ai.length > 0) params.push(['ai', ai.join(',')]);
  return params;
}
