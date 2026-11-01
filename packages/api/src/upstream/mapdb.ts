import { readCappedBody } from './body.js';
import { type MapdbRecord, parseMapdbPage } from './mapdb-parse.js';
import {
  type Fetch,
  MAX_CATALOG_BYTES,
  MAX_CATALOG_RECORDS,
  MAX_PAGE_BYTES,
  UPSTREAM_TIMEOUT_MS,
} from './strapi.js';

/** The list page the mapdb's own search form posts to; `modus=M` selects its maps. */
export function mapdbSearchUrl(upstream: string): string {
  return `${upstream}/mapdb/maps.php?modus=M`;
}

/** The page size the form asks for, which the site's own page selector tops out at. */
export const MAPDB_PAGE_SIZE = 20;
/** Refuses a list that would page the upstream without end. */
const MAX_PAGES = 100;

/** One list page: its row offset and the map records it states. */
interface MapdbPage {
  readonly pos: number;
  readonly records: readonly MapdbRecord[];
  readonly byteLength: number;
}

/** The search form's fixed fields: every map, time-descending, at the site's own page size. */
function formBody(pos: number): string {
  return new URLSearchParams([
    ['order', 'ausgabe DESC'],
    ['pos', String(pos)],
    ['bereich', String(MAPDB_PAGE_SIZE)],
    ['language', '0'],
    ['single', '0'],
    ['orderfeld', 'zeitlich absteigend'],
    ['titel', '%'],
  ]).toString();
}

async function fetchPage(
  fetchFn: Fetch,
  upstream: string,
  pos: number,
  remainingBytes: number,
  remainingRecords: number,
  signal?: AbortSignal,
): Promise<MapdbPage> {
  const response = await fetchFn(mapdbSearchUrl(upstream), {
    method: 'POST',
    body: formBody(pos),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'error',
    signal:
      signal === undefined
        ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        : AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`mapdb page at ${pos} answered ${response.status}`);
  }
  const maxBytes = Math.min(MAX_PAGE_BYTES, remainingBytes);
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`mapdb page at ${pos} exceeds remaining byte budget ${maxBytes}`);
  }
  const bytes = await readCappedBody(response, maxBytes);
  const records = parseMapdbPage(new TextDecoder().decode(bytes));
  if (records.length > Math.min(MAPDB_PAGE_SIZE, remainingRecords)) {
    throw new Error(`mapdb page at ${pos} exceeds remaining record budget`);
  }
  return { pos, records, byteLength: bytes.byteLength };
}

/** Every map of the mapdb, from the first page until one comes back short. Any failed or malformed
 *  page fails the whole download, so a partial list never replaces a whole one. */
export async function fetchMapdbPages(
  fetchFn: Fetch,
  upstream: string,
  signal?: AbortSignal,
): Promise<readonly MapdbRecord[]> {
  signal?.throwIfAborted();
  const records: MapdbRecord[] = [];
  let remainingBytes = MAX_CATALOG_BYTES;
  let remainingRecords = MAX_CATALOG_RECORDS;
  for (let page = 0; page < MAX_PAGES; page++) {
    signal?.throwIfAborted();
    const next = await fetchPage(
      fetchFn,
      upstream,
      page * MAPDB_PAGE_SIZE,
      remainingBytes,
      remainingRecords,
      signal,
    );
    remainingBytes -= next.byteLength;
    remainingRecords -= next.records.length;
    records.push(...next.records);
    if (next.records.length < MAPDB_PAGE_SIZE) return records;
  }
  throw new Error(`mapdb lists more than ${MAX_PAGES} pages of ${MAPDB_PAGE_SIZE} records`);
}
