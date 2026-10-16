import type { MapsIndexEntry, MapsIndexPlayerSlot, MapTextLanguage } from '@open-northland/data';
import { isMultiplayerMapType, MAP_TYPE, narratedLanguages } from '@open-northland/data';
import { catalogEntryThumbnailUrl, type MapSource } from '../../content/map-source/index.js';
import { localizedMapText } from '../../game/map-strings.js';
import { hasWords, searchWords } from '../../hud/dom/parts/name-search.js';
import { compareLabels, currentLocale } from '../../i18n/index.js';

/**
 * Pure state for the map list: the row items it renders, which menu lists a map, the segmented
 * filter, and the search predicate. DOM and fetches live in map-picker.ts.
 */

/** The two menus of the original, each with its own reading of a map's `maptype` codes. */
export type MapListing = 'single' | 'multiplayer';

export type MapFilter = 'all' | 'tutorial' | 'free' | 'multiplayer' | 'scenes';

/** What a map's preview shows: the authored illustration or the terrain minimap. */
export type MapPreviewView = 'picture' | 'map';

/** Navigation actions beside the map filters. */
export type MapActionTab = 'campaign';

export type MapFilterTab =
  | { readonly kind: 'filter'; readonly filter: MapFilter }
  | { readonly kind: 'action'; readonly id: MapActionTab };

/** A room lists multiplayer maps only, so it shows no filter bar. */
export const SINGLE_PLAYER_TABS: readonly MapFilterTab[] = [
  { kind: 'filter', filter: 'all' },
  { kind: 'action', id: 'campaign' },
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
  /** The authored illustration `/maps/<id>.png` exists, or `pictureUrl` names another picture. */
  readonly picture: boolean;
  /** Where the picture shows from when not `/maps/<id>.png`: an installed map's own store, or the
   *  catalogue's screenshot for a catalogue map without an authored picture. */
  readonly pictureUrl?: string;
  /** The terrain minimap `/maps/<id>.map.png` exists. */
  readonly minimap: boolean;
  /** The languages the map's briefing narrator speaks; empty when it ships no voices. */
  readonly narration: readonly MapTextLanguage[];
}

/** The row a map lists as, its title and description read in `lang`. */
export function mapItem(entry: MapsIndexEntry, lang: MapTextLanguage = currentLocale()): MapSelectItem {
  const description = localizedMapText(entry.description, lang);
  const listed = entry.players?.filter((slot) => !slot.hidden) ?? [];
  // The converted mod identifies its tutorial as campaign 100. Using campaign metadata keeps the
  // menu stable when a source folder or generated id is renamed.
  const tutorialStep = entry.campaign?.campaignId === 100 ? entry.campaign.missionId : undefined;
  return {
    kind: 'map',
    id: entry.id,
    title: localizedMapText(entry.name, lang) ?? entry.id,
    types: entry.mapTypes ?? [],
    multiplayerOnly: entry.multiplayerOnly === true,
    seats: listed.map((slot) => ({ tribeId: slot.tribeId, colorId: slot.colorId })),
    players: entry.players ?? [],
    fixedColors: entry.fixedColors === true,
    ...(tutorialStep !== undefined ? { tutorialStep } : {}),
    ...(description !== undefined ? { description } : {}),
    picture: entry.picture,
    minimap: entry.minimap,
    narration: narratedLanguages(entry.voices),
  };
}

/**
 * The row of a map from the source layer. A catalogue map shows its authored picture from wherever
 * it is installed, else the catalogue server's screenshot of its entry; it has no terrain minimap.
 */
export function mapSourceItem(
  source: MapSource,
  api: string,
  lang: MapTextLanguage = currentLocale(),
): MapSelectItem {
  const item = mapItem(source.entry, lang);
  if (source.catalog === undefined)
    return source.pictureUrl === undefined ? item : { ...item, picture: true, pictureUrl: source.pictureUrl };
  const pictureUrl = source.pictureUrl ?? catalogEntryThumbnailUrl(api, source.catalog.entryId);
  return { ...item, picture: true, pictureUrl, minimap: false };
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
    picture: false,
    minimap: false,
    narration: [],
  };
}

/**
 * The previews a map offers, the default first; the card shows a switch only when there are two.
 * An authored picture is the designer's chosen reveal, so only a multiplayer map, open to every
 * player anyway, also offers its terrain.
 */
export function mapPreviewViews(item: MapSelectItem): readonly MapPreviewView[] {
  if (item.kind === 'scene') return [];
  if (!item.picture) return item.minimap ? ['map'] : [];
  return item.minimap && mapCategory(item) === 'multiplayer' ? ['picture', 'map'] : ['picture'];
}

/** The preview a row, a room thumb and a freshly shown card open on, or null when there is none. */
export function defaultMapPreview(item: MapSelectItem): MapPreviewView | null {
  return mapPreviewViews(item)[0] ?? null;
}

export function mapPreviewUrl(item: Pick<MapSelectItem, 'id' | 'pictureUrl'>, view: MapPreviewView): string {
  if (view === 'picture' && item.pictureUrl !== undefined) return item.pictureUrl;
  const stem = `/maps/${encodeURIComponent(item.id)}`;
  return view === 'picture' ? `${stem}.png` : `${stem}.map.png`;
}

/** Survives leaving the screen, so a lobby round trip re-enters with the same filter and selection. */
export interface MapSelectMemory {
  filter: MapFilter;
  query: string;
  selectedId: string | null;
}

/** New Game opens on free play; a room shows no tab bar, so it keeps every map under `all`. */
export function initialMapSelectMemory(filter: MapFilter): MapSelectMemory {
  return { filter, query: '', selectedId: null };
}

const has = (item: MapSelectItem, code: number): boolean => item.types.includes(code);
const untyped = (item: MapSelectItem): boolean => item.kind === 'map' && item.types.length === 0;

/** The label a map row and card carry; the highest-ranking of its codes names it. */
export function mapCategory(item: MapSelectItem): Exclude<MapFilter, 'all'> {
  if (item.kind === 'scene') return 'scenes';
  if (item.tutorialStep !== undefined) return 'tutorial';
  if (isMultiplayerMapType(item.types)) return 'multiplayer';
  return 'free';
}

/**
 * Whether a menu lists the map at all. Source basis: the original's multiplayer map-list build takes a
 * map whose type flags are empty or carry `MULTI_PLAYER_FREE`, then, from the user-map root, empty or
 * `USER_MULTI_PLAYER_FREE`; the two sections are one list here, since an item does not carry its root.
 * Its single-player free-game list takes the free types plus a multiplayer map without
 * `mapmultiplayeronly` (the untyped case is carried over from the
 * multiplayer rule). This menu also allows user multiplayer maps in local matches under the same
 * multiplayer-only restriction. Neither list takes `SINGLE_PLAYER_CAMPAIGN`: the original reaches such a map only
 * through its `mapcampaignid` pair, and that lookup's one caller is the sub-map start reached from
 * mission-goal evaluation, so a sub-mission starts from its parent map's script and never from a menu.
 * Approximation: `SINGLE_PLAYER_DEMO` is listed nowhere, its menu being unobserved.
 */
export function listedIn(item: MapSelectItem, listing: MapListing): boolean {
  if (item.kind === 'scene') return listing === 'single';
  if (item.tutorialStep !== undefined) return listing === 'single';
  if (untyped(item)) return true;
  if (listing === 'multiplayer') return isMultiplayerMapType(item.types);
  return (
    has(item, MAP_TYPE.SINGLE_PLAYER_FREE) ||
    has(item, MAP_TYPE.USER_SINGLE_PLAYER_FREE) ||
    (isMultiplayerMapType(item.types) && !item.multiplayerOnly)
  );
}

function matchesFilter(item: MapSelectItem, filter: MapFilter): boolean {
  switch (filter) {
    case 'all':
      return item.kind === 'map' && item.tutorialStep === undefined;
    case 'scenes':
      return item.kind === 'scene';
    case 'tutorial':
      return item.kind === 'map' && item.tutorialStep !== undefined;
    case 'free':
      return (
        untyped(item) || has(item, MAP_TYPE.SINGLE_PLAYER_FREE) || has(item, MAP_TYPE.USER_SINGLE_PLAYER_FREE)
      );
    case 'multiplayer':
      return untyped(item) || (isMultiplayerMapType(item.types) && !item.multiplayerOnly);
  }
}

/**
 * The rows a menu shows: those the listing takes, under the chosen tab (`all` is every map but the
 * tutorial lessons, never a scene). Search finds every typed word in the title or the id stem.
 */
export function filterItems(
  items: readonly MapSelectItem[],
  listing: MapListing,
  filter: MapFilter,
  query: string,
): readonly MapSelectItem[] {
  const words = searchWords(query);
  const matches = items.filter(
    (item) =>
      listedIn(item, listing) && matchesFilter(item, filter) && hasWords(`${item.title}\n${item.id}`, words),
  );
  if (filter === 'scenes') return matches;
  if (filter === 'tutorial') return matches.sort((a, b) => (a.tutorialStep ?? 0) - (b.tutorialStep ?? 0));
  const compare = compareLabels();
  return matches.sort((a, b) => compare(a.title, b.title) || a.id.localeCompare(b.id));
}
