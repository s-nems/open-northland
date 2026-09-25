import type { MapScript } from '@open-northland/data';
import { type GameSession, orderedSeats } from '@open-northland/lockstep';
import { playerNameMap } from './map-roster.js';

export interface ObserverSeatEntry {
  readonly player: number;
  /** The map's authored seat name; absent, the HUD numbers the seat. */
  readonly name?: string;
}

/** The seats an observer may watch, ascending: every seat a person or a computer plays, the map's
 *  own computer seats included, since a hidden or locked seat fields units and buildings like any
 *  other. Only a seat sitting the game out is left off. */
export function observerSeats(session: GameSession, script: MapScript | null): ObserverSeatEntry[] {
  const nameOf = playerNameMap(script);
  const out: ObserverSeatEntry[] = [];
  for (const seat of orderedSeats(session.seats)) {
    if (seat.mode === 'idle') continue;
    const name = nameOf(seat.player);
    out.push(name === undefined ? { player: seat.player } : { player: seat.player, name });
  }
  return out;
}
