import { type MapScript, mapLobbySlots } from '@open-northland/data';
import { type GameSession, orderedSeats } from '@open-northland/lockstep';
import { playerNameMap } from './map-roster.js';
import { isMapComputerSeat } from './session-url.js';

export interface ObserverSeatEntry {
  readonly player: number;
  /** The map's authored seat name; absent, the HUD numbers the seat. */
  readonly name?: string;
}

/**
 * The seats an observer may watch, ascending: the ones a person or a lobby-placed computer plays.
 * A seat the map itself runs as a computer player (authored `ai`, never claimable) is left out, as
 * is one sitting the game out.
 */
export function observerSeats(session: GameSession, script: MapScript | null): ObserverSeatEntry[] {
  const mapComputerSeats = new Set(
    script === null
      ? []
      : mapLobbySlots(script)
          .filter(isMapComputerSeat)
          .map((slot) => slot.player),
  );
  const nameOf = playerNameMap(script);
  const out: ObserverSeatEntry[] = [];
  for (const seat of orderedSeats(session.seats)) {
    if (seat.mode === 'idle' || mapComputerSeats.has(seat.player)) continue;
    const name = nameOf(seat.player);
    out.push(name === undefined ? { player: seat.player } : { player: seat.player, name });
  }
  return out;
}
