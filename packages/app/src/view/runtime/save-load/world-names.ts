import type { MapsIndexEntry, MapTextLanguage } from '@open-northland/data';
import { loadMapList } from '../../../content/maps-index.js';
import { localizedMapText } from '../../../game/map-strings.js';
import { currentLocale, sceneCopy } from '../../../i18n/index.js';

/** World tokens of scene entries; everything else is a decoded map id (`entries/scene.ts`). */
export const SCENE_TOKEN_PREFIX = 'scene:';

export type WorldNameOf = (token: string | null) => string | null;

/**
 * The token-to-display-name join: a scene's localized title, a map's index display name in `lang`, or
 * the raw token when neither source knows it.
 */
export function worldNamesOf(
  entries: readonly MapsIndexEntry[],
  lang: MapTextLanguage = currentLocale(),
): WorldNameOf {
  const byId = new Map(
    entries.flatMap((entry) => {
      const name = localizedMapText(entry.name, lang);
      return name !== undefined ? [[entry.id, name] as const] : [];
    }),
  );
  return (token) => {
    if (token === null) return null;
    if (token.startsWith(SCENE_TOKEN_PREFIX)) {
      const id = token.slice(SCENE_TOKEN_PREFIX.length);
      return sceneCopy(id)?.title ?? id;
    }
    return byId.get(token) ?? token;
  };
}

/** The served maps index, fetched once per document: the roster cannot change under a session, and
 *  every panel open would otherwise re-download it. */
let mapList: Promise<readonly MapsIndexEntry[]> | null = null;

/** The join over the served maps index; contentless checkouts degrade to token pass-through. */
export async function worldNameIndex(): Promise<WorldNameOf> {
  mapList ??= loadMapList();
  return worldNamesOf(await mapList);
}
