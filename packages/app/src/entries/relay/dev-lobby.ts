import { compatibilityIssues, type RoomView } from '@open-northland/net-protocol';

/** The developer lobby's one setting: how many people the creator waits for before starting. */
export interface DevLobbyPlan {
  readonly players: number;
}

export type DevLobbyAction =
  | { readonly kind: 'claimSeat'; readonly player: number }
  | { readonly kind: 'setReady' }
  | { readonly kind: 'start' };

/**
 * The next step of a client that walks the lobby on its own: sit in the first open seat, get ready,
 * and, as the creator, start once the planned number of people are seated and ready. Null when there
 * is nothing to do, the seats are full, or the room has started.
 */
export function devLobbyAction(room: RoomView, selfNick: string, plan: DevLobbyPlan): DevLobbyAction | null {
  if (room.state !== 'lobby') return null;
  const self = room.members.find((member) => member.nick === selfNick);
  if (self === undefined) return null;
  if (self.seat === null) {
    const open = room.seats.find((seat) => seat.nick === null && seat.mode === 'idle');
    return open === undefined ? null : { kind: 'claimSeat', player: open.player };
  }
  if (compatibilityIssues(room.members, room.creator).length > 0) return null;
  const seat = room.seats.find((row) => row.player === self.seat);
  if (seat !== undefined && !seat.ready) return { kind: 'setReady' };
  if (room.creator !== selfNick || room.members.length < plan.players) return null;
  const everyoneReady = room.members.every(
    (member) => room.seats.find((row) => row.player === member.seat)?.ready === true,
  );
  return everyoneReady ? { kind: 'start' } : null;
}
