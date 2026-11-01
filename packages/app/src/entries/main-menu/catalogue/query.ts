import { MAP_TEXT_LANGUAGES, type MapTextLanguage } from '@open-northland/data';
import { foldText, hasWords, searchWords } from '../../../hud/dom/parts/name-search.js';
import { type CatalogueRow, isManualDownload, MAP_SIZES, type MapSize } from './model.js';
import { CATALOGUE_SOURCES, type CatalogueSource } from './source.js';

export type CatalogueSort = 'liked' | 'downloaded' | 'newest' | 'updated' | 'title' | 'author';
export const CATALOGUE_SORTS: readonly CatalogueSort[] = [
  'downloaded',
  'liked',
  'newest',
  'updated',
  'title',
  'author',
];

export type KindFilter = 'all' | 'single' | 'multi' | 'campaign';
export const KIND_FILTERS: readonly KindFilter[] = ['all', 'single', 'multi', 'campaign'];

export interface PlayerBucket {
  readonly id: string;
  readonly min: number;
  readonly max: number;
}

/** The player filter's seat ranges, cut so each holds a fair share of the catalogue's packs. A
 *  one-seat map falls under none. */
export const PLAYER_BUCKETS: readonly PlayerBucket[] = [
  { id: '2', min: 2, max: 2 },
  { id: '3', min: 3, max: 3 },
  { id: '4', min: 4, max: 4 },
  { id: '5-6', min: 5, max: 6 },
  { id: '7-8', min: 7, max: 8 },
  { id: '9+', min: 9, max: Number.POSITIVE_INFINITY },
];

/** How an entry reaches the player: `auto` downloads in the game, `manual` from a page or our kept
 *  file. A failed entry falls under neither. */
export type DownloadMode = 'any' | 'auto' | 'manual';
export const DOWNLOAD_MODES: readonly DownloadMode[] = ['any', 'auto', 'manual'];

/** Which community source the browse tab lists; `any` lists both. */
export type SourceFilter = CatalogueSource | 'any';
export const SOURCE_FILTERS: readonly SourceFilter[] = ['any', ...CATALOGUE_SOURCES];

/** What the browse tab shows: the search, the sort and every filter. */
export interface CatalogueQuery {
  readonly text: string;
  readonly sort: CatalogueSort;
  readonly kind: KindFilter;
  /** Only entries the upstream files under the Cultures series. */
  readonly seriesOnly: boolean;
  /** A `PLAYER_BUCKETS` id some map of the pack falls in; null for any. */
  readonly players: string | null;
  readonly language: MapTextLanguage | null;
  readonly size: MapSize | null;
  /** One author's exact name; null for any. */
  readonly author: string | null;
  readonly download: DownloadMode;
  /** The community source the list draws from, or `any` for both. */
  readonly source: SourceFilter;
  /** Leaves out what the player can already play: installed maps and maps the game ships as listed. */
  readonly hideOwned: boolean;
}

export const DEFAULT_CATALOGUE_QUERY: CatalogueQuery = {
  text: '',
  sort: 'newest',
  kind: 'all',
  seriesOnly: false,
  players: null,
  language: null,
  size: null,
  author: null,
  download: 'any',
  source: 'any',
  hideOwned: false,
};

/** Whether any filter differs from the default; the search and the sort are not filters. */
export function hasActiveFilters(query: CatalogueQuery): boolean {
  const { text: _text, sort: _sort, ...filters } = query;
  const { text: _defaultText, sort: _defaultSort, ...defaults } = DEFAULT_CATALOGUE_QUERY;
  return (Object.keys(filters) as (keyof typeof filters)[]).some((key) => filters[key] !== defaults[key]);
}

function matchesText(row: CatalogueRow, words: readonly string[]): boolean {
  const { title, author, shortDescription, fullDescription } = row.entry;
  return hasWords(`${title}\n${author}\n${shortDescription}\n${fullDescription}`, words);
}

export function matchesPlayers(row: CatalogueRow, bucketId: string | null): boolean {
  if (bucketId === null) return true;
  const bucket = PLAYER_BUCKETS.find((candidate) => candidate.id === bucketId);
  return bucket !== undefined && row.playerCounts.some((count) => count >= bucket.min && count <= bucket.max);
}

export function matchesDownload(row: CatalogueRow, mode: DownloadMode): boolean {
  switch (mode) {
    case 'any':
      return true;
    case 'auto':
      return !isManualDownload(row.status) && row.status !== 'failed';
    case 'manual':
      return isManualDownload(row.status);
  }
}

/** Whether the row comes from the source the query lists. */
export function matchesSource(row: CatalogueRow, source: SourceFilter): boolean {
  return source === 'any' || row.source === source;
}

/** Whether the player can already play the entry and it offers nothing new to download. */
export function isOwned(row: CatalogueRow): boolean {
  return row.status === 'installed' || row.status === 'updatable' || row.status === 'inGame';
}

export function matchesQuery(row: CatalogueRow, query: CatalogueQuery): boolean {
  const { entry } = row;
  return (
    (query.kind === 'all' || entry.kind === query.kind) &&
    (!query.seriesOnly || entry.series) &&
    matchesPlayers(row, query.players) &&
    (query.language === null || row.languages.includes(query.language)) &&
    (query.size === null || row.size === query.size) &&
    (query.author === null || foldText(entry.author) === foldText(query.author)) &&
    matchesDownload(row, query.download) &&
    matchesSource(row, query.source) &&
    (!query.hideOwned || !isOwned(row)) &&
    matchesText(row, searchWords(query.text))
  );
}

type Compare = (a: string, b: string) => number;

const byTime = (a: string, b: string): number => Date.parse(b) - Date.parse(a);

function comparator(sort: CatalogueSort, compareLabels: Compare) {
  const byTitle = (a: CatalogueRow, b: CatalogueRow): number =>
    compareLabels(a.entry.title, b.entry.title) || (a.entry.id < b.entry.id ? -1 : 1);
  switch (sort) {
    case 'liked':
      return (a: CatalogueRow, b: CatalogueRow) =>
        b.entry.likeCount - a.entry.likeCount ||
        b.entry.downloadCount - a.entry.downloadCount ||
        byTitle(a, b);
    case 'downloaded':
      return (a: CatalogueRow, b: CatalogueRow) =>
        b.entry.downloadCount - a.entry.downloadCount ||
        b.entry.likeCount - a.entry.likeCount ||
        byTitle(a, b);
    case 'newest':
      return (a: CatalogueRow, b: CatalogueRow) =>
        byTime(a.entry.publishedAt, b.entry.publishedAt) || byTitle(a, b);
    case 'updated':
      return (a: CatalogueRow, b: CatalogueRow) =>
        byTime(a.entry.updatedAt, b.entry.updatedAt) || byTitle(a, b);
    case 'title':
      return byTitle;
    case 'author':
      return (a: CatalogueRow, b: CatalogueRow) =>
        compareLabels(a.entry.author, b.entry.author) || byTitle(a, b);
  }
}

/** The rows the query keeps, in its order. */
export function queryRows(
  rows: readonly CatalogueRow[],
  query: CatalogueQuery,
  compareLabels: Compare,
): readonly CatalogueRow[] {
  return rows.filter((row) => matchesQuery(row, query)).sort(comparator(query.sort, compareLabels));
}

/** How many listed packs each filter choice keeps, counted once over every listed row. */
export interface FacetCounts {
  readonly players: ReadonlyMap<string, number>;
  readonly languages: ReadonlyMap<MapTextLanguage, number>;
  readonly sizes: ReadonlyMap<MapSize, number>;
  readonly downloads: ReadonlyMap<DownloadMode, number>;
  readonly sources: ReadonlyMap<CatalogueSource, number>;
}

function countBy<K>(
  rows: readonly CatalogueRow[],
  keys: readonly K[],
  keeps: (row: CatalogueRow, key: K) => boolean,
) {
  return new Map(keys.map((key) => [key, rows.filter((row) => keeps(row, key)).length] as const));
}

export function facetCounts(rows: readonly CatalogueRow[]): FacetCounts {
  return {
    players: countBy(
      rows,
      PLAYER_BUCKETS.map((bucket) => bucket.id),
      matchesPlayers,
    ),
    languages: countBy(rows, MAP_TEXT_LANGUAGES, (row, language) => row.languages.includes(language)),
    sizes: countBy(rows, MAP_SIZES, (row, size) => row.size === size),
    downloads: countBy(rows, DOWNLOAD_MODES, matchesDownload),
    sources: countBy(rows, CATALOGUE_SOURCES, matchesSource),
  };
}

export interface AuthorCount {
  readonly name: string;
  readonly count: number;
}

/** Every author with the number of listed packs, the most prolific first, then by name. */
export function authorCounts(rows: readonly CatalogueRow[], compareLabels: Compare): readonly AuthorCount[] {
  const counts = new Map<string, number>();
  for (const { entry } of rows) {
    if (entry.author.trim() !== '') counts.set(entry.author, (counts.get(entry.author) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || compareLabels(a.name, b.name));
}

/** An author counts among the prolific ones with this many listed packs. */
export const PROLIFIC_AUTHOR_MIN_MAPS = 10;

/** What the author picker lists: the prolific authors and everyone by name, or the matches of a
 *  typed name, the most prolific first. */
export type AuthorListing =
  | { readonly kind: 'groups'; readonly top: readonly AuthorCount[]; readonly all: readonly AuthorCount[] }
  | { readonly kind: 'matches'; readonly matches: readonly AuthorCount[] };

export function authorListing(
  authors: readonly AuthorCount[],
  typed: string,
  compareLabels: Compare,
): AuthorListing {
  const words = searchWords(typed);
  if (words.length > 0)
    return { kind: 'matches', matches: authors.filter((author) => hasWords(author.name, words)) };
  return {
    kind: 'groups',
    top: authors.filter((author) => author.count >= PROLIFIC_AUTHOR_MIN_MAPS),
    all: [...authors].sort((a, b) => compareLabels(a.name, b.name)),
  };
}

const BYTES_PER_UNIT = 1024;
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
const SIZE_FRACTION_DIGITS = 1;

/** A byte count in the largest unit that keeps it at least 1, in the locale's own unit names. */
export function formatBytes(bytes: number, localeTag: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit++;
  }
  return new Intl.NumberFormat(localeTag, {
    style: 'unit',
    unit: BYTE_UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : SIZE_FRACTION_DIGITS,
  }).format(value);
}
