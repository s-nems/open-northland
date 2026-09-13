import type { SavedSessionMetadata } from '@open-northland/lockstep';
import { compatibilityIssues, type RoomSeatView, type RoomView } from '@open-northland/net-protocol';

export function roomPermissions(room: RoomView, nick: string, connected: boolean) {
  const self = room.members.find((member) => member.nick === nick);
  const inProgress = room.state !== 'lobby';
  const interactive = connected && !inProgress && self !== undefined;
  const creator = interactive && room.creator === nick;
  const issues = compatibilityIssues(room.members, room.creator, room.settings.initialSave);
  const ready = room.seats.find((seat) => seat.player === self?.seat)?.ready ?? false;
  const allReady =
    room.members.length > 0 &&
    room.members.every(
      (member) =>
        member.connected &&
        member.seat !== null &&
        room.seats.some((seat) => seat.player === member.seat && seat.ready),
    );
  return {
    interactive,
    canRejoin: inProgress && connected && self !== undefined,
    creator,
    canSetupSeats: creator && room.settings.initialSave === undefined,
    self,
    ready,
    issues,
    canReady: interactive && self.seat !== null && (ready || issues.length === 0),
    canStart: creator && allReady && issues.length === 0,
  };
}

export function canClaimSeat(room: RoomView, seat: RoomSeatView, nick: string, connected: boolean): boolean {
  return roomPermissions(room, nick, connected).interactive && seat.nick === null;
}

export function savedSeatHint(metadata: SavedSessionMetadata | null, player: number, nick: string) {
  const saved = metadata?.roster.find((seat) => seat.player === player);
  if (saved?.nick == null) return null;
  return { nick: saved.nick, recommended: saved.nick === nick };
}
