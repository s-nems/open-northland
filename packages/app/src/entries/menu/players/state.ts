/**
 * Pure roster state for the map-select player panel: seats, colours and vacant modes over the
 * slots `/maps-index` serves. No DOM — the panel half lives in `panel.ts`; everything here is
 * headlessly unit-tested.
 */

/** One map player slot as `/maps-index` serves it (the script sidecar's roster + lobby table). */
export interface MapPlayerSlot {
  readonly player: number;
  /** The authored `playerdata` type — what the slot does when nobody sits on it. */
  readonly type: 'human' | 'ai';
  readonly tribeId: number;
  readonly colorId: number;
  readonly name?: string;
  /** Whether a person may take this seat (authored `human`, or the map's `[multiplayer]`
   *  `playeroption` row offers `human` — the original lobby's seat-eligibility table). */
  readonly claimable: boolean;
  /** `[multiplayer]` `playerhideinmenu` — never listed (but still in the game and wearing its
   *  authored colour, so its colour stays reserved in the picker). */
  readonly hidden: boolean;
  /** Whether the seat may auto-play when vacant — its `playeroption` row offers `ai` (or the map
   *  ships no row). Human/Closed-only rows exist in the corpus; those seats never get the toggle. */
  readonly aiAllowed: boolean;
}

/** What a free claimable seat does once the game starts: nothing, or the strategic AI plays it. */
export type VacantMode = 'idle' | 'ai';

/** The read-only observer pseudo-seat: watch and inspect the match without controlling a slot or
 *  issuing any command (`?player=observer`). */
export const OBSERVER_SEAT = 'observer';

/** The overseer (god-mode) pseudo-seat: watch every seat and command all of them (`?player=overseer`)
 *  — the same whole-map view as the observer, but with live control, kept as a sandbox/debug session. */
export const OVERSEER_SEAT = 'overseer';

/** A claimed session: a roster slot id, or one of the spectator pseudo-seats
 *  ({@link OBSERVER_SEAT} read-only, {@link OVERSEER_SEAT} god-mode). */
export type SeatChoice = number | typeof OBSERVER_SEAT | typeof OVERSEER_SEAT;

/** A slot's authored vacant default: an `ai` slot auto-plays (when the lobby allows AI at all),
 *  a `human` one idles. */
export function authoredVacantMode(slot: MapPlayerSlot): VacantMode {
  return slot.type === 'ai' && slot.aiAllowed ? 'ai' : 'idle';
}

/** Whether the roster offers any seat a person could take — when it does not (an all-AI mod map),
 *  the menu must not gate Start on a seat that cannot exist. */
export function hasClaimableSeat(players: readonly MapPlayerSlot[]): boolean {
  return players.some((p) => p.claimable && !p.hidden);
}

/** The person's choices over one map's roster. */
export interface RosterState {
  /** The claimed seat (a slot id or the observer pseudo-seat), or null while none is taken
   *  (Start stays gated). */
  readonly seat: SeatChoice | null;
  /** Current colour per slot id (initialised from the map's authored colours). */
  readonly colors: ReadonlyMap<number, number>;
  /** Per-slot vacant mode, initialised from the authored type ({@link authoredVacantMode}). */
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

/** Flips one unclaimed claimable slot between Idle and AI. */
export function toggleVacantMode(state: RosterState, slot: number): RosterState {
  const vacantModes = new Map(state.vacantModes);
  vacantModes.set(slot, vacantModes.get(slot) === 'ai' ? 'idle' : 'ai');
  return { ...state, vacantModes };
}

/** Whether any slot other than `slot` currently wears `colorId`. Real maps author duplicate
 *  colours freely (tutorial rosters are all-blue), so "worn" is always relative to the asker. */
export function wornByAnother(state: RosterState, slot: number, colorId: number): boolean {
  for (const [other, c] of state.colors) if (other !== slot && c === colorId) return true;
  return false;
}

/**
 * Recolours one slot. The person's picks are unique: a colour another slot wears is rejected
 * (null); re-picking the slot's own colour is a no-op accepted for idempotent UI (authored
 * duplicates stay as the map shipped them — they just can't be newly created).
 */
export function setSlotColor(state: RosterState, slot: number, colorId: number): RosterState | null {
  if (state.colors.get(slot) !== colorId && wornByAnother(state, slot, colorId)) return null;
  const colors = new Map(state.colors);
  colors.set(slot, colorId);
  return { ...state, colors };
}

/**
 * The vacant seats the strategic AI will play: claimable, AI-eligible, listed slots the person left
 * free whose effective mode (the toggle's, else the authored default) is `ai`.
 */
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
 * The start-URL params encoding the person's roster choices: `player=<seat>` (a slot id, or
 * `observer`/`overseer` for a spectator session),
 * `colors=<slot>:<colorId>,…` (only slots recoloured away from the map's authored colour) and
 * `ai=<slot>,…` — the full {@link aiSeats} list (not just deviations: the `?map=` entry consumes it
 * directly via `aiSeatsParam`, with no roster knowledge of its own). Empty until a seat is
 * claimed — the menu gates Start on it.
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
