import { CIVILIZATION_TRIBES, type MapsIndexPlayerSlot } from '@open-northland/data';
import type { ComputerDifficulty, LocalSeat } from '@open-northland/lockstep';
import { isReservedMapAiSeat } from '../../../game/match/session-url.js';

/**
 * Pure roster state behind the lobby screen: seats, colours, civilizations and vacant modes over the slots
 * `maps-index.json` lists. No DOM, so it is unit-tested headlessly.
 */

/** One map player slot as `maps-index.json` lists it. */
export type MapPlayerSlot = MapsIndexPlayerSlot;

/** Map AI follows the author's switches, Computer enables autonomous control, and Idle keeps the
 *  entities without AI control. Absent omits the seat’s starting entities. */
export type VacantMode = 'map-ai' | 'idle' | 'computer' | 'absent';

export { OBSERVER_SEAT, OVERSEER_SEAT } from '@open-northland/lockstep';

/** How hard a seat a network room hands to the computer plays until someone picks another level. */
export const DEFAULT_COMPUTER_DIFFICULTY: ComputerDifficulty = 'medium';

/** How hard a saved world's computer seat plays when the save names no level: `setAiControl`'s own. */
export const SAVED_COMPUTER_DIFFICULTY: ComputerDifficulty = 'hard';

/** How hard the map's own computer seat plays until someone picks a level: `setAiControl`'s own, which it
 *  played before the lobby offered one. */
export const MAP_COMPUTER_DIFFICULTY: ComputerDifficulty = 'hard';

/** How hard a seat the single-player lobby hands to the computer plays until the person picks a level. */
export const LOCAL_COMPUTER_DIFFICULTY: ComputerDifficulty = 'hard';

/** The level `slot` starts at in a fresh lobby or room. */
export function startingDifficulty(slot: MapPlayerSlot): ComputerDifficulty {
  return isReservedMapAiSeat(slot) ? MAP_COMPUTER_DIFFICULTY : DEFAULT_COMPUTER_DIFFICULTY;
}

/** The single-player lobby fills every open seat the map lets the computer take with the computer. */
function localVacantMode(slot: MapPlayerSlot): VacantMode {
  const authored = authoredVacantMode(slot);
  return authored === 'idle' && slot.claimable && slot.aiAllowed ? 'computer' : authored;
}

/** What the lobby lets a person claim, which is what the session then plays. */
export type SeatChoice = LocalSeat;

/** Reserved AI follows the map; selectable AI defaults to Computer, human seats to Idle. */
export function authoredVacantMode(slot: MapPlayerSlot): VacantMode {
  if (slot.type === 'none') return 'absent';
  if (isReservedMapAiSeat(slot)) return 'map-ai';
  return slot.type === 'ai' && slot.aiAllowed ? 'computer' : 'idle';
}

/** The vacant modes the map's `playeroption` row offers the seat, in the lobby's order. Idle is
 *  always there: it is a person's seat nobody took. The map's own computer seat keeps its mode. */
export function vacantOffers(slot: MapPlayerSlot): VacantMode[] {
  if (!slot.claimable) return [authoredVacantMode(slot)];
  return [
    ...(slot.aiAllowed ? ['computer' as const] : []),
    'idle',
    ...(slot.noneAllowed ? ['absent' as const] : []),
  ];
}

/** A seat the map gives a civilization may be played as any other; a monster seat keeps its tribe.
 *  `civilizations` is the content's list - the authored five plus a pack's flagged tribes rows
 *  (`docs/MODS.md`, "New civilizations"). */
export function offersTribeChoice(
  slot: MapPlayerSlot,
  civilizations: readonly number[] = CIVILIZATION_TRIBES,
): boolean {
  return civilizations.includes(slot.tribeId);
}

/** Claimable civilization seats offer computer difficulty; a locked computer needs active autonomous
 *  modules. Monster tribes have no computer difficulty. */
export function offersDifficulty(
  slot: MapPlayerSlot,
  civilizations: readonly number[] = CIVILIZATION_TRIBES,
): boolean {
  return (
    (slot.claimable || isReservedMapAiSeat(slot)) &&
    !slot.hidden &&
    slot.aiAllowed &&
    (slot.claimable || slot.hasComputerControl) &&
    offersTribeChoice(slot, civilizations)
  );
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
  /** Current civilization per slot id, initialised from the map's authored tribes. */
  readonly tribes: ReadonlyMap<number, number>;
  /** Per-slot vacant mode, initialised from the authored type. */
  readonly vacantModes: ReadonlyMap<number, VacantMode>;
  /** The level picked per slot; an unpicked computer seat plays its {@link startingDifficulty}. */
  readonly difficulties: ReadonlyMap<number, ComputerDifficulty>;
}

export function initialRosterState(players: readonly MapPlayerSlot[]): RosterState {
  return {
    seat: null,
    colors: new Map(players.map((p) => [p.player, p.colorId])),
    tribes: new Map(players.map((p) => [p.player, p.tribeId])),
    vacantModes: new Map(players.map((p) => [p.player, localVacantMode(p)])),
    difficulties: new Map(),
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

export function setSlotTribe(state: RosterState, slot: number, tribe: number): RosterState {
  const tribes = new Map(state.tribes);
  tribes.set(slot, tribe);
  return { ...state, tribes };
}

export function setSlotDifficulty(
  state: RosterState,
  slot: number,
  difficulty: ComputerDifficulty,
): RosterState {
  const difficulties = new Map(state.difficulties);
  difficulties.set(slot, difficulty);
  return { ...state, difficulties };
}

/** How hard `slot` plays should the computer take it. */
export function slotDifficulty(state: RosterState, slot: MapPlayerSlot): ComputerDifficulty {
  const unpicked = isReservedMapAiSeat(slot) ? MAP_COMPUTER_DIFFICULTY : LOCAL_COMPUTER_DIFFICULTY;
  return state.difficulties.get(slot.player) ?? unpicked;
}

/** The first slot other than `slot` that wears `colorId`, if any. Real maps author duplicate colours
 *  freely, so this is relative to the asking slot. */
export function wearerOf(state: RosterState, slot: number, colorId: number): number | undefined {
  for (const [other, c] of state.colors) if (other !== slot && c === colorId) return other;
  return undefined;
}

/**
 * A colour another slot already wears is rejected with `null`; re-picking the slot's own colour is
 * accepted, so authored duplicates survive but new ones cannot be created.
 */
export function setSlotColor(state: RosterState, slot: number, colorId: number): RosterState | null {
  if (state.colors.get(slot) !== colorId && wearerOf(state, slot, colorId) !== undefined) return null;
  const colors = new Map(state.colors);
  colors.set(slot, colorId);
  return { ...state, colors };
}

/** The offered seats the computer player controls, what `?computer=` carries: a slot's effective mode is the
 *  toggle's when set, else the authored default. The map's own computer seats are not the lobby's to
 *  list; see `isReservedMapAiSeat`. */
export function computerSeats(state: RosterState, players: readonly MapPlayerSlot[]): number[] {
  return vacantSeatsIn(state, players, 'computer')
    .filter((p) => p.aiAllowed)
    .map((p) => p.player);
}

export function idleSeats(state: RosterState, players: readonly MapPlayerSlot[]): number[] {
  return vacantSeatsIn(state, players, 'idle').map((p) => p.player);
}

/** Offered seats omitted from the fresh world's placements. */
export function absentSeats(state: RosterState, players: readonly MapPlayerSlot[]): number[] {
  return vacantSeatsIn(state, players, 'absent')
    .filter((slot) => slot.noneAllowed)
    .map((slot) => slot.player);
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
