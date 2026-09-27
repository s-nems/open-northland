import type { MapScript, MapTextLanguage } from '@open-northland/data';
import { localizedMapText } from './map-strings.js';
import { PRIMARY_TRIBE } from './rules.js';

/**
 * The seat's tribe (`MapPlayerSlot.tribeId`), which the entities it raises are stamped with, falling back
 * to {@link PRIMARY_TRIBE} off-roster. Reading the roster row as the *build* tribe is readable-semantics
 * inference: `tribetypes.ini` scopes `allowhouse` per tribe, and the row is the only tribe a seat carries
 * before it owns anything.
 */
export function playerTribe(script: Pick<MapScript, 'players'> | null, player: number): number {
  return script?.players.find((p) => p.player === player)?.tribeId ?? PRIMARY_TRIBE;
}

/**
 * A seat's authored display name (`MapPlayerSlot.name`) read in `lang`, or `undefined` when the map
 * ships none. The one thing that tells two seats of the same tribe apart, so the stats panel names the
 * seat with it.
 */
export function playerNameMap(
  script: Pick<MapScript, 'players'> | null,
  lang: MapTextLanguage,
): (player: number) => string | undefined {
  const bySlot = new Map<number, string>();
  for (const p of script?.players ?? []) {
    const name = localizedMapText(p.name, lang);
    if (name !== undefined) bySlot.set(p.player, name);
  }
  return (player) => bySlot.get(player);
}
