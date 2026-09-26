import { parseNick, type RoomSummary } from '@open-northland/net-protocol';
import { compareLabels } from '../../../i18n/index.js';

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

/** The lobbies by the name each row shows; the id only breaks a tie between alike names. */
export function openRooms(rooms: readonly RoomSummary[]): readonly RoomSummary[] {
  const compare = compareLabels();
  return rooms
    .filter((room) => room.state === 'lobby')
    .sort((a, b) => compare(a.name, b.name) || a.id.localeCompare(b.id));
}
