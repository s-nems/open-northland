import { PLAYERS_SIGHT, type WatchTarget } from '../game/viewer-seat.js';
import { isActionHotkey } from './hotkeys.js';
import {
  type KeyBindings,
  SPECTATOR_ACTIONS,
  SPECTATOR_SEAT_ACTIONS,
  type SpectatorAction,
} from './keybindings.js';

/** The spectator key this press is, or null; the focused control keeps its own keys. */
export function spectatorKeyAction(e: KeyboardEvent, bindings: KeyBindings): SpectatorAction | null {
  return SPECTATOR_ACTIONS.find((action) => isActionHotkey(e, bindings, action)) ?? null;
}

/** What a watch key shows over `seats`, in the picker's order; undefined for a seat key past the list
 *  and for a key that watches nothing. */
export function watchTargetOf(action: SpectatorAction, seats: readonly number[]): WatchTarget | undefined {
  if (action === 'watchPlayersSight') return PLAYERS_SIGHT;
  if (action === 'watchRevealedMap') return null;
  return seats[SPECTATOR_SEAT_ACTIONS.indexOf(action)];
}

/** The key action that watches `target` over `seats`, or null for a seat past the keyed ones. */
export function watchActionOf(target: WatchTarget, seats: readonly number[]): SpectatorAction | null {
  if (target === PLAYERS_SIGHT) return 'watchPlayersSight';
  if (target === null) return 'watchRevealedMap';
  return SPECTATOR_SEAT_ACTIONS[seats.indexOf(target)] ?? null;
}
