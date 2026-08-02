import type { MapsIndexEntry } from '@open-northland/content-resolver/wire';

/**
 * Pure state for the map-select screen (design frame 4a): the row items the list renders, the
 * segmented filter, and the search predicate. DOM and fetches live in map-select.ts.
 */

export type MapFilter = 'all' | 'story' | 'multiplayer' | 'scenes';

/** Segmented-filter order, matching the design frame left to right. */
export const MAP_FILTERS: readonly MapFilter[] = ['all', 'story', 'multiplayer', 'scenes'];

export interface MapSelectItem {
  /** A decoded map (opens the lobby) or a registered test scene (starts directly). */
  readonly kind: 'map' | 'scene';
  readonly id: string;
  readonly title: string;
  readonly category: Exclude<MapFilter, 'all'>;
  /** Listed (non-hidden) roster slots; 0 when the map ships no roster. */
  readonly playerCount: number;
  readonly description?: string;
  /** `/maps/<id>.png` exists, so rows and the preview can use the decoded minimap. */
  readonly minimap: boolean;
}

/** A `/maps-index` entry as a list row. Category comes from the script sidecar's `[multiplayer]`
 *  table (the original's own multiplayer capability marker); everything else is story. */
export function mapItem(entry: MapsIndexEntry): MapSelectItem {
  const listed = entry.players?.filter((slot) => !slot.hidden) ?? [];
  return {
    kind: 'map',
    id: entry.id,
    title: entry.name ?? entry.id,
    category: entry.multiplayer === true ? 'multiplayer' : 'story',
    playerCount: listed.length,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    minimap: entry.minimap,
  };
}

/** A registered test scene as a list row. */
export function sceneItem(id: string, title: string, summary: string): MapSelectItem {
  return {
    kind: 'scene',
    id,
    title,
    category: 'scenes',
    playerCount: 0,
    description: summary,
    minimap: false,
  };
}

/**
 * The rows the list shows for a filter + search query. `all` lists every decoded map; test scenes
 * appear only under their own filter. Search matches the display title or the id stem, case-folded
 * locale-independently (host locale must not change what an id query matches).
 */
export function filterItems(
  items: readonly MapSelectItem[],
  filter: MapFilter,
  query: string,
): readonly MapSelectItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === 'all' ? item.kind !== 'map' : item.category !== filter) return false;
    if (needle === '') return true;
    return item.title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle);
  });
}

export interface PluralForms {
  readonly one: string;
  readonly few: string;
  readonly many: string;
}

/** Picks the CLDR plural form for `count`; categories beyond one/few (`many`, `other`) fall to
 *  `many`, which is also English's plural. */
export function pluralForm(count: number, forms: PluralForms, localeTag: string): string {
  const category = new Intl.PluralRules(localeTag).select(count);
  return category === 'one' ? forms.one : category === 'few' ? forms.few : forms.many;
}
