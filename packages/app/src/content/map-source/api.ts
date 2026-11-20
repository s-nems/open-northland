import { CatalogBrowseEntry, type CatalogConvertedMap, CatalogEntry } from '@open-northland/data';
import { diag } from '../../diag/log.js';
import type { MapFileSuffix } from './files.js';

declare const __API_URL__: string | null;

/** The map catalogue server a build talks to unless `ON_API_URL` or `?api=` names another. */
export const DEFAULT_API_URL = 'https://api.opennorthland.org';

export const CATALOG_REQUEST_TIMEOUT_MS = 30_000;

export function catalogRequestSignal(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(CATALOG_REQUEST_TIMEOUT_MS);
  return signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
}

export const API_PARAM = 'api';
const WEB_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** An http(s) origin and path without the trailing slash, or null for anything else. */
export function apiBase(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim());
    if (!WEB_PROTOCOLS.includes(url.protocol) || url.search !== '' || url.hash !== '') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Browser harnesses drive the game under automation; whatever runs there reaches a live server only
 * when the URL names one with `param`.
 */
export function automationWithoutServer(
  param: string,
  search: string = window.location.search,
  webdriver: boolean = navigator.webdriver,
): boolean {
  return webdriver && apiBase(new URLSearchParams(search).get(param)) === null;
}

/** `?api=` first, then the build's `ON_API_URL`, then the production server. */
export function apiBaseUrl(search: string = window.location.search): string {
  return (
    apiBase(new URLSearchParams(search).get(API_PARAM)) ??
    apiBase(typeof __API_URL__ === 'string' ? __API_URL__ : null) ??
    DEFAULT_API_URL
  );
}

export const catalogUrl = (api: string): string => `${api}/v1/catalog`;
export const catalogEntryUrl = (api: string, entryId: string): string =>
  `${api}/v1/maps/${encodeURIComponent(entryId)}`;
export const catalogSidecarUrl = (
  api: string,
  irVersion: number,
  mapId: string,
  suffix: MapFileSuffix,
): string => `${api}/v1/content/${irVersion}/maps/${encodeURIComponent(mapId)}${suffix}`;

/** Where the catalogue server keeps an entry's screenshot; it answers 404 when it has none. */
export const catalogEntryThumbnailUrl = (api: string, entryId: string): string =>
  `${api}/v1/maps/${encodeURIComponent(entryId)}/thumbnail`;

/** The entry's screenshot on the catalogue server, or null when the server has none. */
export function catalogThumbnailUrl(api: string, entry: Pick<CatalogEntry, 'thumbnail'>): string | null {
  return entry.thumbnail === undefined ? null : `${api}${entry.thumbnail}`;
}

/** The entry's file as the catalogue server kept it, for a player to unpack by hand; null until the
 *  server fetched a file, and on an entry hosted on another site. */
export function catalogFileUrl(api: string, entry: Pick<CatalogEntry, 'file'>): string | null {
  const { file } = entry;
  return file.kind === 'external' || file.path === undefined ? null : `${api}${file.path}`;
}

/** The converted maps of an entry the server finished, else none. */
export function convertedMaps(entry: CatalogEntry): readonly CatalogConvertedMap[] {
  return entry.conversion?.verdict === 'ok' ? entry.conversion.maps : [];
}

/** The catalogue, keeping every entry this build reads; throws when the server cannot be reached. */
export async function fetchCatalog(
  api: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<readonly CatalogBrowseEntry[]> {
  const response = await fetchImpl(catalogUrl(api), { signal: catalogRequestSignal(signal) });
  if (!response.ok) throw new Error(`Map catalogue: HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('Map catalogue: expected a list');
  const entries: CatalogBrowseEntry[] = [];
  let skipped = 0;
  for (const raw of body) {
    const parsed = CatalogBrowseEntry.safeParse(raw);
    if (parsed.success) entries.push(parsed.data);
    else skipped++;
  }
  // A newer server may add entry shapes this build does not know; the rest still list.
  if (skipped > 0) diag.warn('content', 'map catalogue: skipped entries this build cannot read', { skipped });
  return entries;
}

/** One entry, or null when the server does not know it; throws when the server cannot be reached. */
export async function fetchCatalogEntry(
  api: string,
  entryId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CatalogEntry | null> {
  const response = await fetchImpl(catalogEntryUrl(api, entryId), { signal: catalogRequestSignal(signal) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Map catalogue: HTTP ${response.status}`);
  return CatalogEntry.parse(await response.json());
}
