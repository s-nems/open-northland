import type { MapText } from '@open-northland/data';
import type { SessionWorld } from '@open-northland/lockstep';
import { parseNick, type RoomSummary } from '@open-northland/net-protocol';
import { localizedMapText } from '../../../game/map-strings.js';
import { compareLabels, currentLocale, type Locale, sceneCopy } from '../../../i18n/index.js';

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

/** A room's world as the player reads it: the map's or scene's title in `lang`, else its id. */
export function worldTitle(
  world: SessionWorld,
  mapNames: ReadonlyMap<string, MapText | undefined>,
  lang: Locale = currentLocale(),
): string {
  if (world.kind === 'scene') return sceneCopy(world.sceneId, lang)?.title ?? world.sceneId;
  return localizedMapText(mapNames.get(world.mapId), lang) ?? world.mapId;
}
