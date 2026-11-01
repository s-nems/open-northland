import { CATALOG_MAP_ID, CatalogEntry } from '@open-northland/data';
import type { MapdbRecord } from '../upstream/mapdb-parse.js';
import { permittedDownloadUrl } from '../upstream/urls.js';
import { classifyFile, type Normalized, type NormalizedRecord, type SkippedRecord } from './normalize.js';

/** The entry-id prefix of every wikinger-tommy.de mapdb map; the client derives the map's source
 *  from it, and the catalogue contract gains nothing the old clients would refuse. */
export const WIKINGER_TOMMY_ID_PREFIX = 'wt-';
/** The mapdb's id runs out at 125 characters so the prefix keeps the id inside its schema. */
const ID_MAX_LENGTH = 125;
const VERSION_IN_NAME = /_v(\d+(?:-\d+)*)\.exe$/i;

/** When the mapdb first named a map, by its upstream key, from a stored catalogue. The mapdb's list
 *  carries no dates, so these keep an entry's dates stable from one sync to the next. */
export interface FirstSeen {
  readonly publishedAt: string;
  readonly updatedAt: string;
}

/** The `datei` path a download link hands to the upstream's downloader, or null when the link is
 *  not one of its exe downloads. */
export function mapdbDateiPath(downloadPath: string): string | null {
  let url: URL;
  try {
    url = new URL(downloadPath, 'https://wikinger-tommy.de');
  } catch {
    return null;
  }
  if (url.pathname !== '/mapdb/download.php') return null;
  const match = /[?&]datei=([^&]+)/.exec(url.search);
  if (match === null) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1] ?? '');
  } catch {
    return null;
  }
  if (!path.startsWith('/') || !path.toLowerCase().endsWith('.exe') || path.split('/').includes('..'))
    return null;
  return path;
}

/** German letters the NFKD fold cannot reduce, spelled as the community writes them. */
const GERMAN_PLAIN: Readonly<Record<string, string>> = { ß: 'ss' };

/** Our entry id for a `datei` path: the file's name, slugified. Null when nothing readable remains. */
export function mapdbMapId(dateiPath: string): string | null {
  const base = dateiPath.slice(dateiPath.lastIndexOf('/') + 1).replace(/\.exe$/i, '');
  const slug = base
    .replace(/[ß]/g, (letter) => GERMAN_PLAIN[letter] ?? letter)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ID_MAX_LENGTH)
    .replace(/-+$/g, '');
  if (slug === '') return null;
  const id = `${WIKINGER_TOMMY_ID_PREFIX}${slug}`;
  return CATALOG_MAP_ID.test(id) ? id : null;
}

/** A stable numeric stand-in for the upstream's per-record id, which its list does not give. */
function numericKey(documentId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < documentId.length; index++) {
    hash ^= documentId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 0x80000000;
}

/** The mapdb page a player opens for a map: its campaign when it belongs to one, else its author. */
export function mapdbPageUrl(upstream: string, record: MapdbRecord): string {
  if (record.campaignId !== null) return `${upstream}/mapdb/maps.php?modus=K&Id=${record.campaignId}`;
  if (record.authorId !== null) return `${upstream}/mapdb/maps.php?modus=A&Id=${record.authorId}`;
  return `${upstream}/mapdb/maps.php`;
}

/** The version the file name carries, such as `v2-1-0`; absent when it names none. */
function versionText(dateiPath: string): string | undefined {
  const match = VERSION_IN_NAME.exec(dateiPath);
  return match === null ? undefined : `v${match[1]}`;
}

/** The first-seen dates of the stored catalogue's mapdb entries, by their upstream key. */
export function firstSeenDates(entries: readonly CatalogEntry[]): ReadonlyMap<string, FirstSeen> {
  const dates = new Map<string, FirstSeen>();
  for (const entry of entries) {
    if (!entry.id.startsWith(WIKINGER_TOMMY_ID_PREFIX)) continue;
    const { documentId } = entry.source;
    if (documentId !== '')
      dates.set(documentId, { publishedAt: entry.publishedAt, updatedAt: entry.updatedAt });
  }
  return dates;
}

function screenshotUrl(record: MapdbRecord, upstream: string): string | null {
  const path = record.screenshotPath;
  if (path === null || path === '') return null;
  try {
    const url = new URL(path, upstream);
    return permittedDownloadUrl(url, upstream) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Whether a stored raw record is a mapdb record shape the normalizer can read. */
function isMapdbRecord(value: unknown): value is MapdbRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<MapdbRecord>;
  return (
    typeof record.title === 'string' &&
    typeof record.author === 'string' &&
    (record.authorId === null || typeof record.authorId === 'number') &&
    (record.downloadPath === null || typeof record.downloadPath === 'string') &&
    (record.screenshotPath === null || typeof record.screenshotPath === 'string') &&
    (record.campaignId === null || typeof record.campaignId === 'number') &&
    (record.language === null || record.language === 'de' || record.language === 'en') &&
    (record.players === null || record.players === 'single' || record.players === 'multi') &&
    typeof record.genre === 'string' &&
    typeof record.description === 'string'
  );
}

function normalizeRecord(
  record: MapdbRecord,
  upstream: string,
  firstSeen: ReadonlyMap<string, FirstSeen>,
  now: () => string,
): NormalizedRecord | SkippedRecord {
  const skip = (reason: string): SkippedRecord => ({ upstreamId: record.title, reason });
  if (record.language === null) return skip('language cell');
  if (record.players === null) return skip('player cell');
  if (record.downloadPath === null) return skip('no download; the page says to load it from its campaign');
  const dateiPath = mapdbDateiPath(record.downloadPath);
  if (dateiPath === null) return skip('download link');
  const id = mapdbMapId(dateiPath);
  if (id === null) return skip(`file name ${dateiPath}`);
  const fileUrl = new URL(record.downloadPath, upstream).toString();
  const file = classifyFile(fileUrl, upstream);
  if (file === null || file.kind === 'external') return skip('download origin');
  const documentId = dateiPath;
  const dates = firstSeen.get(documentId) ?? { publishedAt: now(), updatedAt: now() };
  const version = versionText(dateiPath);
  // The schema is the served contract: an entry it refuses would fail every later catalogue write.
  const checked = CatalogEntry.safeParse({
    id,
    source: { documentId, id: numericKey(documentId), page: mapdbPageUrl(upstream, record) },
    title: record.title,
    shortDescription: '',
    fullDescription: record.description,
    author: record.author,
    kind: record.players,
    series: false,
    categoryLabel: record.genre,
    publishedAt: dates.publishedAt,
    updatedAt: dates.updatedAt,
    downloadCount: 0,
    likeCount: 0,
    ...(version === undefined ? {} : { versionText: version }),
    file,
  });
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return skip(`schema: ${issue === undefined ? 'invalid' : `${issue.path.join('.')} ${issue.message}`}`);
  }
  return { entry: checked.data, screenshotUrl: screenshotUrl(record, upstream), fileUrl };
}

/** Mapdb maps as catalogue entries, sorted by id; the rest with a reason. A second record with an
 *  id already taken is skipped, so ids stay unique. */
export function normalizeMapdbRecords(
  records: readonly unknown[],
  upstream: string,
  firstSeen: ReadonlyMap<string, FirstSeen> = new Map(),
  now: () => string = () => new Date().toISOString(),
): Normalized {
  const byId = new Map<string, NormalizedRecord>();
  const skipped: SkippedRecord[] = [];
  for (const parsed of records) {
    if (!isMapdbRecord(parsed)) {
      skipped.push({ upstreamId: null, reason: 'not a mapdb record' });
      continue;
    }
    const result = normalizeRecord(parsed, upstream, firstSeen, now);
    if ('reason' in result) skipped.push(result);
    else if (byId.has(result.entry.id))
      skipped.push({ upstreamId: result.entry.source.id, reason: 'duplicate id' });
    else byId.set(result.entry.id, result);
  }
  const sorted = [...byId.values()].sort((a, b) =>
    a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0,
  );
  return { records: sorted, skipped };
}
