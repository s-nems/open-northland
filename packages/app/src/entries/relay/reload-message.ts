import type { ServerMessage } from '@open-northland/net-protocol';

/** A returning token may receive its room before the explicit join's rejection arrives. */
export function ignoreReconnectRejection(
  message: ServerMessage,
  requestedRoom: string,
  activeRoom: string | null,
): boolean {
  return message.kind === 'rejected' && message.of === 'joinRoom' && activeRoom === requestedRoom;
}
export function wrongReconnectRoom(message: ServerMessage, requestedRoom: string): boolean {
  return message.kind === 'room' && message.room.id !== requestedRoom;
}
