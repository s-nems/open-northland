import type { MapsIndexPlayerSlot } from '@open-northland/data';
import type { LocalSeat } from '@open-northland/lockstep';

/**
 * Pure roster state behind the lobby screen: seats, colours and vacant modes over the slots
 * `maps-index.json` lists. No DOM, so it is unit-tested headlessly.
 */

/** One map player slot as `maps-index.json` lists it. */
export type MapPlayerSlot = MapsIndexPlayerSlot;

/** What a free claimable seat does once the game starts: nothing, the strategic AI plays it, or it
 *  is left off the map. */
export type VacantMode = 'idle' | 'ai' | 'absent';

export { OBSERVER_SEAT, OVERSEER_SEAT } from '@open-northland/lockstep';

/** What the lobby lets a person claim, which is what the session then plays. */
export type SeatChoice = LocalSeat;

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

export function setVacantMode(state: RosterState, slot: number, mode: VacantMode): RosterState {
  const vacantModes = new Map(state.vacantModes);
  vacantModes.set(slot, mode);
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

/** The offered seats the strategic AI plays, what `?ai=` carries: a slot's effective mode is the
 *  toggle's when set, else the authored default. The map's own computer seats are not the lobby's to
 *  list; see `isMapComputerSeat`. */
export function aiSeats(state: RosterState, players: readonly MapPlayerSlot[]): number[] {
  return vacantSeatsIn(state, players, 'ai')
    .filter((p) => p.aiAllowed)
    .map((p) => p.player);
}

/** The offered seats left off the map, what `?absent=` carries. */
export function absentSeats(state: RosterState, players: readonly MapPlayerSlot[]): number[] {
  return vacantSeatsIn(state, players, 'absent').map((p) => p.player);
}

function vacantSeatsIn(
  state: RosterState,
  players: readonly MapPlayerSlot[],
  mode: VacantMode,
): MapPlayerSlot[] {
  return players.filter(
    (p) =>
      p.claimable &&
      !p.hidden &&
      p.player !== state.seat &&
      (state.vacantModes.get(p.player) ?? authoredVacantMode(p)) === mode,
  );
}
