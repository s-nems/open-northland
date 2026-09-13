import { parseNick, type RoomSummary } from '@open-northland/net-protocol';

export { relayAddress } from '../../../net/address.js';

/** The relay's own rule for a nick, so the menu refuses exactly what `hello` would. */
export function validNetworkNick(nick: string): boolean {
  try {
    parseNick(nick, 'nick');
    return true;
  } catch {
    return false;
  }
}

/** Esc inside a line the player is still writing clears the line; only an idle field or the screen
 *  itself lets it leave the room. */
export function escapeLeavesRoom(target: EventTarget | null): boolean {
  if (target === null || !('tagName' in target) || !('value' in target)) return true;
  const field = target as { readonly tagName: unknown; readonly value: unknown };
  const editable = field.tagName === 'INPUT' || field.tagName === 'TEXTAREA';
  return !(editable && typeof field.value === 'string' && field.value !== '');
}

export function openRooms(rooms: readonly RoomSummary[]): readonly RoomSummary[] {
  return rooms.filter((room) => room.state === 'lobby').sort((a, b) => a.id.localeCompare(b.id));
}
