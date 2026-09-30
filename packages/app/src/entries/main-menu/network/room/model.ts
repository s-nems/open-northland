import { isCivilizationTribe } from '@open-northland/data';
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

/** The map's civilization for a seat that may play another; null for a seat without one, such as a
 *  monster's. */
export function seatCivilization(seat: RoomSeatView): number | null {
  return seat.authoredTribe !== undefined && isCivilizationTribe(seat.authoredTribe)
    ? seat.authoredTribe
    : null;
}

/** The creator chooses any seat's civilization and a seated member its own, as the relay allows; a
 *  saved world's civilizations stand. */
export function canSetSeatTribe(
  room: RoomView,
  seat: RoomSeatView,
  nick: string,
  connected: boolean,
): boolean {
  const permissions = roomPermissions(room, nick, connected);
  if (!permissions.interactive || room.settings.initialSave !== undefined) return false;
  return permissions.creator || (seat.nick !== null && seat.nick === nick);
}

/** The creator sets a computer seat's level while the room is set up; a saved world's levels stand. */
export function canSetSeatDifficulty(room: RoomView, nick: string, connected: boolean): boolean {
  const permissions = roomPermissions(room, nick, connected);
  return permissions.canSetupSeats && permissions.creator && room.settings.initialSave === undefined;
}

export function savedSeatHint(metadata: SavedSessionMetadata | null, player: number, nick: string) {
  const saved = metadata?.roster.find((seat) => seat.player === player);
  if (saved?.nick == null) return null;
  return { nick: saved.nick, recommended: saved.nick === nick };
}
