import type { RoomSeatView } from '@open-northland/net-protocol';
import type { KeptView } from './kept-view.js';

type SeatsOfRoom = { readonly seats: readonly Pick<RoomSeatView, 'player' | 'nick'>[] };

export interface SeatNicks {
  note(room: SeatsOfRoom | null): void;
  nickOf(player: number): string | undefined;
}

/** The nick last seen in each seat of a running room. The room clears a seat's nick when its player
 *  turns to watching or leaves; the seat keeps it here and in `kept`, so the result names it by who
 *  played it, after a reload of the tab too. */
export function createSeatNicks(kept: Pick<KeptView, 'seatNicks' | 'setSeatNicks'> | null): SeatNicks {
  const nicks = new Map<number, string>(kept?.seatNicks() ?? []);
  return {
    note(room): void {
      let changed = false;
      for (const seat of room?.seats ?? []) {
        if (seat.nick === null || nicks.get(seat.player) === seat.nick) continue;
        nicks.set(seat.player, seat.nick);
        changed = true;
      }
      if (changed) kept?.setSeatNicks([...nicks]);
    },
    nickOf: (player) => nicks.get(player),
  };
}
