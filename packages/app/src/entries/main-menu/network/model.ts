import { MAX_NICK_LENGTH, type RoomSummary } from '@open-northland/net-protocol';

export { relayAddress } from '../../../net/address.js';

export function validNetworkNick(nick: string): boolean {
  return nick.length > 0 && nick.length <= MAX_NICK_LENGTH && /^\P{C}+$/u.test(nick);
}

export function openRooms(rooms: readonly RoomSummary[]): readonly RoomSummary[] {
  return rooms.filter((room) => room.state === 'lobby').sort((a, b) => a.id.localeCompare(b.id));
}
