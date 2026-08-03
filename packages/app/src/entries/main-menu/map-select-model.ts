import type { MapsIndexEntry, MapsIndexPlayerSlot } from '@open-northland/content-resolver/wire';

/**
 * Pure state for the map-select screen (design frame 4a): the row items the list renders, the
 * segmented filter, and the search predicate. DOM and fetches live in map-select.ts.
 */

export type MapFilter = 'all' | 'story' | 'multiplayer' | 'scenes';

/** A mode the corpus cannot serve yet; its tab renders greyed out with a coming-soon tooltip. */
export type ComingSoonTab = 'campaign' | 'tutorial';

export type MapFilterTab =
  | { readonly kind: 'filter'; readonly filter: MapFilter }
  | { readonly kind: 'comingSoon'; readonly id: ComingSoonTab };

/** Segmented-bar order: the coming-soon modes sit next to "all", before the live filters. */
export const MAP_FILTER_TABS: readonly MapFilterTab[] = [
  { kind: 'filter', filter: 'all' },
  { kind: 'comingSoon', id: 'campaign' },
  { kind: 'comingSoon', id: 'tutorial' },
  { kind: 'filter', filter: 'story' },
  { kind: 'filter', filter: 'multiplayer' },
  { kind: 'filter', filter: 'scenes' },
];

/** One listed roster slot as the details card shows it: authored tribe + team colour. */
export interface MapSeat {
  readonly tribeId: number;
  readonly colorId: number;
}

export interface MapSelectItem {
  /** A decoded map (opens the lobby) or a registered test scene (starts directly). */
  readonly kind: 'map' | 'scene';
  readonly id: string;
  readonly title: string;
  readonly category: Exclude<MapFilter, 'all'>;
  /** Listed (non-hidden) roster slots in authored order; empty when the map ships no roster. */
  readonly seats: readonly MapSeat[];
  /** The full authored roster the lobby negotiates (hidden slots included); scenes carry none. */
  readonly players: readonly MapsIndexPlayerSlot[];
  /** `[multiplayer]` `playerfixcolors` — the lobby locks its team-colour pickers. */
  readonly fixedColors: boolean;
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
    seats: listed.map((slot) => ({ tribeId: slot.tribeId, colorId: slot.colorId })),
    players: entry.players ?? [],
    fixedColors: entry.fixedColors === true,
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
    seats: [],
    players: [],
    fixedColors: false,
    description: summary,
    minimap: false,
  };
}

/**
 * The map-select UI state that survives leaving the screen (a lobby round trip re-enters with the
 * same filter, query and selection). Owned by the menu shell, mutated by the screen.
 */
export interface MapSelectMemory {
  filter: MapFilter;
  query: string;
  selectedId: string | null;
}

export function initialMapSelectMemory(): MapSelectMemory {
  return { filter: 'all', query: '', selectedId: null };
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
