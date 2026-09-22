import type { MapsIndexEntry, MapsIndexPlayerSlot } from '@open-northland/data';
import { MAP_TYPE } from '@open-northland/data';

/**
 * Pure state for the map list: the row items it renders, which menu lists a map, the segmented
 * filter, and the search predicate. DOM and fetches live in map-picker.ts.
 */

/** The two menus of the original, each with its own reading of a map's `maptype` codes. */
export type MapListing = 'single' | 'multiplayer';

export type MapFilter = 'all' | 'tutorial' | 'free' | 'multiplayer' | 'scenes';

/** A mode of the original this build cannot launch yet (its maps are `SINGLE_PLAYER_CAMPAIGN`,
 *  which no list takes); its tab renders greyed out with a coming-soon tooltip. */
export type ComingSoonTab = 'campaign';

export type MapFilterTab =
  | { readonly kind: 'filter'; readonly filter: MapFilter }
  | { readonly kind: 'comingSoon'; readonly id: ComingSoonTab };

/** Segmented-bar order of the New Game screen: the coming-soon modes sit by "all", before the live
 *  filters. A room lists multiplayer maps only, so it shows no bar. */
export const SINGLE_PLAYER_TABS: readonly MapFilterTab[] = [
  { kind: 'filter', filter: 'all' },
  { kind: 'comingSoon', id: 'campaign' },
  { kind: 'filter', filter: 'tutorial' },
  { kind: 'filter', filter: 'free' },
  { kind: 'filter', filter: 'multiplayer' },
  { kind: 'filter', filter: 'scenes' },
];
export const ROOM_TABS: readonly MapFilterTab[] = [];

export interface MapSeat {
  readonly tribeId: number;
  readonly colorId: number;
}

export interface MapSelectItem {
  /** A decoded map (tutorials start directly) or a registered test scene. */
  readonly kind: 'map' | 'scene';
  readonly id: string;
  readonly title: string;
  /** `[misc_maptype]` codes; empty for a scene and for a map whose header declares none. */
  readonly types: readonly number[];
  /** `[misc_maptype]` `mapmultiplayeronly`. */
  readonly multiplayerOnly: boolean;
  /** Listed (non-hidden) roster slots in authored order; empty when the map ships no roster. */
  readonly seats: readonly MapSeat[];
  /** The full authored roster the lobby negotiates (hidden slots included); scenes carry none. */
  readonly players: readonly MapsIndexPlayerSlot[];
  /** `[multiplayer]` `playerfixcolors` - the lobby locks its team-colour pickers. */
  readonly fixedColors: boolean;
  /** Mission number inside the authored tutorial campaign; absent for every other map and scene. */
  readonly tutorialStep?: number;
  readonly description?: string;
  /** `/maps/<id>.png` exists, so rows and the preview can use the decoded minimap. */
  readonly minimap: boolean;
}

export function mapItem(entry: MapsIndexEntry): MapSelectItem {
  const listed = entry.players?.filter((slot) => !slot.hidden) ?? [];
  // The converted mod identifies its tutorial as campaign 100. Using campaign metadata keeps the
  // menu stable when a source folder or generated id is renamed.
  const tutorialStep = entry.campaign?.campaignId === 100 ? entry.campaign.missionId : undefined;
  return {
    kind: 'map',
    id: entry.id,
    title: entry.name ?? entry.id,
    types: entry.mapTypes ?? [],
    multiplayerOnly: entry.multiplayerOnly === true,
    seats: listed.map((slot) => ({ tribeId: slot.tribeId, colorId: slot.colorId })),
    players: entry.players ?? [],
    fixedColors: entry.fixedColors === true,
    ...(tutorialStep !== undefined ? { tutorialStep } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    minimap: entry.minimap,
  };
}

export function sceneItem(id: string, title: string, summary: string): MapSelectItem {
  return {
    kind: 'scene',
    id,
    title,
    types: [],
    multiplayerOnly: false,
    seats: [],
    players: [],
    fixedColors: false,
    description: summary,
    minimap: false,
  };
}

/** Survives leaving the screen, so a lobby round trip re-enters with the same filter and selection. */
export interface MapSelectMemory {
  filter: MapFilter;
  query: string;
  selectedId: string | null;
}

export function initialMapSelectMemory(): MapSelectMemory {
  return { filter: 'all', query: '', selectedId: null };
}

const has = (item: MapSelectItem, code: number): boolean => item.types.includes(code);
const untyped = (item: MapSelectItem): boolean => item.kind === 'map' && item.types.length === 0;

/** The label a map row and card carry; the highest-ranking of its codes names it. */
export function mapCategory(item: MapSelectItem): Exclude<MapFilter, 'all'> {
  if (item.kind === 'scene') return 'scenes';
  if (item.tutorialStep !== undefined) return 'tutorial';
  if (has(item, MAP_TYPE.MULTI_PLAYER_FREE) || has(item, MAP_TYPE.USER_MULTI_PLAYER_FREE))
    return 'multiplayer';
  return 'free';
}

/**
 * Whether a menu lists the map at all. Source basis: the original's multiplayer map-list build takes a
 * map whose type flags are empty or carry `MULTI_PLAYER_FREE`, then, from the user-map root, empty or
 * `USER_MULTI_PLAYER_FREE`; the two sections are one list here, since an item does not carry its root.
 * Its single-player free-game list takes the free types plus a multiplayer map without
 * `mapmultiplayeronly` (the untyped case is carried over from the
 * multiplayer rule). Neither list takes `SINGLE_PLAYER_CAMPAIGN`: the original reaches such a map only
 * through its `mapcampaignid` pair, and that lookup's one caller is the sub-map start reached from
 * mission-goal evaluation, so a sub-mission starts from its parent map's script and never from a menu.
 * Approximation: `SINGLE_PLAYER_DEMO` is listed nowhere, its menu being unobserved.
 */
export function listedIn(item: MapSelectItem, listing: MapListing): boolean {
  if (item.kind === 'scene') return listing === 'single';
  if (item.tutorialStep !== undefined) return listing === 'single';
  if (untyped(item)) return true;
  if (listing === 'multiplayer')
    return has(item, MAP_TYPE.MULTI_PLAYER_FREE) || has(item, MAP_TYPE.USER_MULTI_PLAYER_FREE);
  return (
    has(item, MAP_TYPE.SINGLE_PLAYER_FREE) ||
    has(item, MAP_TYPE.USER_SINGLE_PLAYER_FREE) ||
    (has(item, MAP_TYPE.MULTI_PLAYER_FREE) && !item.multiplayerOnly)
  );
}

function matchesFilter(item: MapSelectItem, filter: MapFilter): boolean {
  switch (filter) {
    case 'all':
      return item.kind === 'map';
    case 'scenes':
      return item.kind === 'scene';
    case 'tutorial':
      return item.kind === 'map' && item.tutorialStep !== undefined;
    case 'free':
      return (
        untyped(item) || has(item, MAP_TYPE.SINGLE_PLAYER_FREE) || has(item, MAP_TYPE.USER_SINGLE_PLAYER_FREE)
      );
    case 'multiplayer':
      return (
        untyped(item) ||
        (has(item, MAP_TYPE.MULTI_PLAYER_FREE) && !item.multiplayerOnly) ||
        has(item, MAP_TYPE.USER_MULTI_PLAYER_FREE)
      );
  }
}

/**
 * The rows a menu shows: those the listing takes, under the chosen tab (`all` is every map, never a
 * scene). Search matches the title or the id stem, case-folded locale-independently so the host
 * locale cannot change the match.
 */
export function filterItems(
  items: readonly MapSelectItem[],
  listing: MapListing,
  filter: MapFilter,
  query: string,
): readonly MapSelectItem[] {
  const needle = query.trim().toLowerCase();
  const matches = items.filter((item) => {
    if (!listedIn(item, listing) || !matchesFilter(item, filter)) return false;
    if (needle === '') return true;
    return item.title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle);
  });
  if (filter !== 'tutorial') return matches;
  return matches.sort((a, b) => (a.tutorialStep ?? 0) - (b.tutorialStep ?? 0));
}

export interface PluralForms {
  readonly one: string;
  readonly few: string;
  readonly many: string;
}

const pluralRulesByTag = new Map<string, Intl.PluralRules>();

/** Picks the CLDR plural form for `count`; categories beyond one/few (`many`, `other`) fall to
 *  `many`, which is also English's plural. One `Intl.PluralRules` per locale - the list calls
 *  this per rendered row on every keystroke. */
export function pluralForm(count: number, forms: PluralForms, localeTag: string): string {
  let rules = pluralRulesByTag.get(localeTag);
  if (rules === undefined) {
    rules = new Intl.PluralRules(localeTag);
    pluralRulesByTag.set(localeTag, rules);
  }
  const category = rules.select(count);
  return category === 'one' ? forms.one : category === 'few' ? forms.few : forms.many;
}
