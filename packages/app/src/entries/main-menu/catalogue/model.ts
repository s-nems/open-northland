import {
  type CatalogBrowseEntry,
  type CatalogBrowseMap,
  MAP_TEXT_LANGUAGES,
  MAP_TYPE,
  type MapsIndexEntry,
  type MapTextLanguage,
} from '@open-northland/data';
import type { LocalSourceRecord } from '../../../content/local-import/source.js';
import type { InstalledMapRecord } from '../../../content/map-source/index.js';
import { titleKey } from './fold.js';
import { type CatalogueSource, catalogueSource } from './source.js';

/**
 * What a player can do with an entry:
 * - `external`: the file lives on another site; only its page opens, the player downloads it there;
 * - `manual`: the server kept the file but could not unpack it; the player downloads it from our API
 *   and unpacks it by hand;
 * - `failed`: the server could not fetch or convert it and kept no file; only its reason shows;
 * - `pending`: the server has not converted it yet; nothing is clickable;
 * - `gameTooOld` / `serverTooOld`: converted for another content version than this build's;
 * - `available`: downloadable; `installed`: playable; `updatable`: playable, with a newer conversion;
 * - `redownload`: installed for an older content version, downloadable again;
 * - `inGame`: every map of the pack ships with the game, same documents; Play starts the shipped map;
 * - `inGameChanged`: the pack's maps ship with the game in another version, or only some do; its own
 *   copy downloads beside the shipped one.
 */
export type CatalogueStatus =
  | 'external'
  | 'manual'
  | 'failed'
  | 'pending'
  | 'gameTooOld'
  | 'serverTooOld'
  | 'available'
  | 'installed'
  | 'updatable'
  | 'redownload'
  | 'inGame'
  | 'inGameChanged';

export type MapSize = 'small' | 'medium' | 'large' | 'huge';
export const MAP_SIZES: readonly MapSize[] = ['small', 'medium', 'large', 'huge'];

/** The sides of the largest square small, medium and large maps, in cells. A map is sized by its
 *  area, so a long 250x80 map counts as small. The catalogue's maps run from 50x50 to 500x500, a
 *  third of them 250x250; these edges split them about 22/27/47/4. */
export const SMALL_MAP_MAX_SIDE = 150;
export const MEDIUM_MAP_MAX_SIDE = 200;
export const LARGE_MAP_MAX_SIDE = 250;
/** The largest cell areas a small, a medium and a large map have. */
export const SMALL_MAP_MAX_CELLS = SMALL_MAP_MAX_SIDE * SMALL_MAP_MAX_SIDE;
export const MEDIUM_MAP_MAX_CELLS = MEDIUM_MAP_MAX_SIDE * MEDIUM_MAP_MAX_SIDE;
export const LARGE_MAP_MAX_CELLS = LARGE_MAP_MAX_SIDE * LARGE_MAP_MAX_SIDE;

export function mapSize(cells: CatalogBrowseMap['cells']): MapSize {
  const area = cells.width * cells.height;
  if (area <= SMALL_MAP_MAX_CELLS) return 'small';
  if (area <= MEDIUM_MAP_MAX_CELLS) return 'medium';
  return area <= LARGE_MAP_MAX_CELLS ? 'large' : 'huge';
}

export interface CatalogueRow {
  readonly entry: CatalogBrowseEntry;
  /** The server's converted maps for this entry; empty until it converted them. */
  readonly maps: readonly CatalogBrowseMap[];
  /** The server's main map id, else the installed or shipped map shown by the card. */
  readonly mainMapId: string | null;
  /** The pack's other maps, installed with the main one. */
  readonly subMapCount: number;
  readonly status: CatalogueStatus;
  /** The installed main map's id while it can be played. */
  readonly playableMapId: string | null;
  /** The installed main map's listing row, which Play and Choose start. */
  readonly playableIndex: MapsIndexEntry | null;
  /** Every seat count a map of the pack offers, ascending. */
  readonly playerCounts: readonly number[];
  /** Every language a map of the pack carries, in `MAP_TEXT_LANGUAGES` order. */
  readonly languages: readonly MapTextLanguage[];
  /** The community source the entry came from. */
  readonly source: CatalogueSource;
  /** The main map's size; null until the server converted the entry. */
  readonly size: MapSize | null;
  /** The shipped map the pack's main map (else its first matched map) is a copy of, on an `inGame` or
   *  `inGameChanged` row. */
  readonly shipped: ShippedMatch | null;
}

/** A catalogue map the game already ships: a converted one under its archive folder name, or an
 *  entry without a converted copy under one of the shipped map's titles. */
export interface ShippedMatch {
  readonly index: MapsIndexEntry;
  /** The two copies have the same terrain and script documents; null for a title match, where the
   *  catalogue holds no converted copy to compare. */
  readonly sameVersion: boolean | null;
}

/** The shipped listing rows by lower-cased id, the key a catalogue map's `folder` meets, and by the
 *  `titleKey` of each of their names. */
export interface ShippedMaps {
  readonly byFolder: ReadonlyMap<string, MapsIndexEntry>;
  readonly byTitle: ReadonlyMap<string, MapsIndexEntry>;
}

export const NO_SHIPPED_MAPS: ShippedMaps = { byFolder: new Map(), byTitle: new Map() };

export function shippedMaps(entries: readonly MapsIndexEntry[]): ShippedMaps {
  const byTitle = new Map<string, MapsIndexEntry>();
  // A pack's main map claims a title before its campaign sub maps, which may share it.
  const mainFirst = [...entries].sort(
    (a, b) => Number(a.campaign !== undefined) - Number(b.campaign !== undefined),
  );
  for (const entry of mainFirst) {
    for (const name of Object.values(entry.name ?? {})) {
      const key = titleKey(name);
      if (key !== '' && !byTitle.has(key)) byTitle.set(key, entry);
    }
  }
  return { byFolder: new Map(entries.map((entry) => [entry.id.toLowerCase(), entry])), byTitle };
}

function shippedMatch(map: CatalogBrowseMap, shipped: ShippedMaps): ShippedMatch | null {
  const index = shipped.byFolder.get(map.folder.toLowerCase());
  return index === undefined ? null : { index, sameVersion: index.fingerprint === map.fingerprint };
}

/** How the pack's maps meet the shipped ones: null when none ships with the game. */
function shippedState(
  maps: readonly CatalogBrowseMap[],
  main: CatalogBrowseMap | null,
  shipped: ShippedMaps,
): { readonly status: 'inGame' | 'inGameChanged'; readonly shipped: ShippedMatch } | null {
  const matches = maps.map((map) => shippedMatch(map, shipped));
  const shown =
    (main === null ? null : matches[maps.indexOf(main)]) ?? matches.find((match) => match !== null) ?? null;
  if (shown === null) return null;
  const same = matches.every((match) => match?.sameVersion === true);
  return { status: same ? 'inGame' : 'inGameChanged', shipped: shown };
}

/**
 * The map a pack starts from: the one without a campaign slot, else the first that is not a
 * campaign-only sub map, else the first. The card shows it and counts the rest.
 */
export function mainCatalogMap<T extends { readonly index: MapsIndexEntry }>(maps: readonly T[]): T | null {
  return (
    maps.find((map) => map.index.campaign === undefined) ??
    maps.find((map) => !(map.index.mapTypes ?? []).includes(MAP_TYPE.SINGLE_PLAYER_CAMPAIGN)) ??
    maps[0] ??
    null
  );
}

/** The seats a player could take on a map. */
export function playerCount(index: MapsIndexEntry | null): number {
  return index?.players?.filter((slot) => !slot.hidden).length ?? 0;
}

function serverStatus(entry: CatalogBrowseEntry, irVersion: number): CatalogueStatus {
  if (entry.file.kind === 'external') return 'external';
  const conversion = entry.conversion;
  if (conversion === undefined || conversion.verdict === 'pending') return 'pending';
  if (conversion.verdict === 'failed') return entry.file.path === undefined ? 'failed' : 'manual';
  if (conversion.irVersion > irVersion) return 'gameTooOld';
  if (conversion.irVersion < irVersion) return 'serverTooOld';
  return 'available';
}

/** An installed copy is current while the server's map has its documents and its text languages. */
function isCurrentCopy(record: InstalledMapRecord, map: CatalogBrowseMap): boolean {
  return (
    record.mapId === map.mapId &&
    record.fingerprint === map.fingerprint &&
    record.languages.length === map.languages.length &&
    record.languages.every((language) => map.languages.includes(language))
  );
}

function packFacts(maps: readonly CatalogBrowseMap[]) {
  const counts = new Set(maps.map((map) => map.playerCount).filter((count) => count > 0));
  const languages = new Set(maps.flatMap((map) => map.languages));
  return {
    playerCounts: [...counts].sort((a, b) => a - b),
    languages: MAP_TEXT_LANGUAGES.filter((language) => languages.has(language)),
  };
}

/** One row per entry, its status joined from the server's conversion, the installed maps and the maps
 *  the game ships. */
export function catalogueRow(
  entry: CatalogBrowseEntry,
  installed: readonly InstalledMapRecord[],
  irVersion: number,
  shipped: ShippedMaps = NO_SHIPPED_MAPS,
): CatalogueRow {
  const maps = entry.conversion?.verdict === 'ok' ? entry.conversion.maps : [];
  const current = installed.filter((record) => record.entryId === entry.id && record.irVersion === irVersion);
  const served = serverStatus(entry, irVersion);
  const installedMain = mainCatalogMap(current);
  const mainMapId = entry.conversion?.verdict === 'ok' ? entry.conversion.mainMapId : null;
  const serverMain = maps.find((map) => map.mapId === mainMapId) ?? null;
  const facts = packFacts(maps);
  const base = {
    entry,
    maps,
    mainMapId: serverMain?.mapId ?? installedMain?.mapId ?? null,
    subMapCount: Math.max(0, (maps.length > 0 ? maps.length : current.length) - 1),
    size: serverMain === null ? null : mapSize(serverMain.cells),
    shipped: null,
    source: catalogueSource(entry.id),
    ...facts,
  };
  if (installedMain !== null) {
    // Playable now; a different conversion on the server for this version is an update.
    const differs =
      served === 'available' &&
      (maps.length !== current.length ||
        maps.some((map) => !current.some((record) => isCurrentCopy(record, map))));
    return {
      ...base,
      status: differs ? 'updatable' : 'installed',
      playableMapId: installedMain.mapId,
      playableIndex: installedMain.index,
    };
  }
  const installedElsewhere = installed.some((record) => record.entryId === entry.id);
  if (installedElsewhere && served === 'available') {
    return { ...base, status: 'redownload', playableMapId: null, playableIndex: null };
  }
  // An entry the server holds no converted copy of (a file on another site, one unpacked by hand, a
  // failed one) is the shipped map that carries its title; nothing compares their versions.
  if (maps.length === 0) {
    const index = shipped.byTitle.get(titleKey(entry.title));
    if (index !== undefined)
      return {
        ...base,
        mainMapId: index.id,
        playerCounts: [playerCount(index)].filter((count) => count > 0),
        status: 'inGame',
        shipped: { index, sameVersion: null },
        playableMapId: index.id,
        playableIndex: index,
      };
  }
  // Fingerprints compare only within one content version, which `available` guarantees.
  const inGame = served === 'available' ? shippedState(maps, serverMain, shipped) : null;
  if (inGame?.status === 'inGame') {
    const { index } = inGame.shipped;
    return { ...base, ...inGame, playableMapId: index.id, playableIndex: index };
  }
  if (inGame !== null) return { ...base, ...inGame, playableMapId: null, playableIndex: null };
  return { ...base, status: served, playableMapId: null, playableIndex: null };
}

/** Whether the entry holds no map at all, such as a map for another game; the catalogue never lists it. */
export function isMapless(entry: CatalogBrowseEntry): boolean {
  return entry.conversion?.verdict === 'failed' && entry.conversion.reason === 'no-map';
}

/** The listed rows: every entry but a mapless one. */
export function catalogueRows(
  entries: readonly CatalogBrowseEntry[],
  installed: readonly InstalledMapRecord[],
  irVersion: number,
  shipped: ShippedMaps = NO_SHIPPED_MAPS,
): readonly CatalogueRow[] {
  return entries
    .filter((entry) => !isMapless(entry))
    .map((entry) => catalogueRow(entry, installed, irVersion, shipped));
}

/** Whether the row offers a download: a fresh install, an update, a re-download or the catalogue's
 *  own version of a shipped map. */
export function canDownload(status: CatalogueStatus): boolean {
  return (
    status === 'available' || status === 'updatable' || status === 'redownload' || status === 'inGameChanged'
  );
}

/** Whether the player downloads the entry's file outside the game: from another site or from our API. */
export function isManualDownload(status: CatalogueStatus): boolean {
  return status === 'external' || status === 'manual';
}

/** One installed catalogue entry as the Installed tab lists it: its maps on disk, and the catalogue's
 *  row when the catalogue still lists the entry. */
export interface InstalledGroup {
  readonly entryId: string;
  readonly records: readonly InstalledMapRecord[];
  readonly row: CatalogueRow | null;
  readonly source?: LocalSourceRecord;
  /** Bytes of every stored file of the entry. */
  readonly bytes: number;
  readonly installedAt: number;
}

/** The installed entries, the most recently installed first. */
export function installedGroups(
  records: readonly InstalledMapRecord[],
  rows: readonly CatalogueRow[],
  sources: readonly LocalSourceRecord[] = [],
): readonly InstalledGroup[] {
  const byEntry = new Map<string, InstalledMapRecord[]>();
  for (const record of records) {
    const group = byEntry.get(record.entryId);
    if (group === undefined) byEntry.set(record.entryId, [record]);
    else group.push(record);
  }
  for (const source of sources) if (!byEntry.has(source.entryId)) byEntry.set(source.entryId, []);
  const sourceOf = new Map(sources.map((source) => [source.entryId, source]));
  const rowOf = new Map(rows.map((row) => [row.entry.id, row]));
  return [...byEntry]
    .map(([entryId, own]) => {
      const source = sourceOf.get(entryId);
      return {
        entryId,
        records: own,
        row: rowOf.get(entryId) ?? null,
        ...(source === undefined ? {} : { source }),
        bytes: own.reduce((sum, record) => sum + record.size, sourceOf.get(entryId)?.size ?? 0),
        installedAt: Math.max(0, ...own.map((record) => record.installedAt)),
      };
    })
    .sort((a, b) => b.installedAt - a.installedAt || (a.entryId < b.entryId ? -1 : 1));
}

/** Imported campaign slots are reached from their parent scenario, never from the library. */
export function isImportedMainMap(index: MapsIndexEntry): boolean {
  return index.campaign === undefined && !(index.mapTypes ?? []).includes(MAP_TYPE.SINGLE_PLAYER_CAMPAIGN);
}

interface InstalledMapRow {
  readonly group: InstalledGroup;
  readonly map: InstalledMapRecord | null;
}

export function installedMapRows(groups: readonly InstalledGroup[]): readonly InstalledMapRow[] {
  return groups.flatMap<InstalledMapRow>((group) => {
    if (group.row !== null || group.records.length === 0) return [{ group, map: null }];
    if (
      group.source === undefined &&
      !group.records.some((record) => record.index.provenance?.kind === 'user')
    )
      return [{ group, map: mainCatalogMap(group.records) }];
    return group.records.filter((record) => isImportedMainMap(record.index)).map((map) => ({ group, map }));
  });
}
