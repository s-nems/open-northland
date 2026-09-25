import { type MapScript, mapLobbySlots } from '@open-northland/data';
import { type GameSession, orderedSeats } from '@open-northland/lockstep';
import { playerNameMap } from './map-roster.js';

export interface ObserverSeatEntry {
  readonly player: number;
  /** The map's authored seat name; absent, the HUD numbers the seat. */
  readonly name?: string;
}

/**
 * The seats an observer may watch, ascending: the ones a person may sit in (the lobby's claimable
 * rows, played by a person or a lobby-placed computer). The map's own computer seats, locked or
 * hidden in the lobby, are left out, as is a seat sitting the game out or left off the map. A seat the roster never
 * authored counts as claimable, the way the session parser reads it.
 */
export function observerSeats(session: GameSession, script: MapScript | null): ObserverSeatEntry[] {
  const authored = new Map(script === null ? [] : mapLobbySlots(script).map((slot) => [slot.player, slot]));
  const nameOf = playerNameMap(script);
  const out: ObserverSeatEntry[] = [];
  for (const seat of orderedSeats(session.seats)) {
    if (seat.mode === 'idle' || seat.mode === 'absent' || authored.get(seat.player)?.claimable === false)
      continue;
    const name = nameOf(seat.player);
    out.push(name === undefined ? { player: seat.player } : { player: seat.player, name });
  }
  return out;
}
