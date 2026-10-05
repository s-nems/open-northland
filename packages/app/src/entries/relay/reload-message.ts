import type { ServerMessage } from '@open-northland/net-protocol';

/** The relay put the returning token back into a room other than the one the reload names. */
export function wrongReconnectRoom(message: ServerMessage, requestedRoom: string): boolean {
  return message.kind === 'room' && message.room.id !== requestedRoom;
}
