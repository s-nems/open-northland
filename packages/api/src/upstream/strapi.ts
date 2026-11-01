import { readCappedBody } from './body.js';

/** The subset of `fetch` the API calls, so a test hands in its own. */
export type Fetch = (
  url: string,
  init?: {
    readonly signal?: AbortSignal;
    readonly redirect?: 'error' | 'manual';
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
    readonly body?: string;
  },
) => Promise<Response>;

/** The largest page the upstream Strapi honours. */
export const UPSTREAM_PAGE_SIZE = 100;
/** A hang guard for one upstream request. */
export const UPSTREAM_TIMEOUT_MS = 30_000;
/** Refuses a `pageCount` that would page the upstream without end. */
const MAX_PAGES = 100;
/** Byte limits apply to decoded response bodies, including chunked and compressed responses. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
export const MAX_CATALOG_RECORDS = 5000;

/** One downloaded catalogue page: its number, the parsed body and the records it lists. */
export interface UpstreamPage {
  readonly page: number;
  readonly body: unknown;
  readonly records: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The catalogue query: every download whose category names maps or campaigns. */
export function catalogPageUrl(upstream: string, page: number): string {
  const query = [
    'filters[$or][0][category][$containsi]=mapy',
    'filters[$or][1][category][$containsi]=kampanie',
    `pagination[pageSize]=${UPSTREAM_PAGE_SIZE}`,
    `pagination[page]=${page}`,
  ].join('&');
  return `${upstream}/api/downloads?${query}`;
}

async function fetchPage(
  fetchFn: Fetch,
  upstream: string,
  page: number,
  remainingBytes: number,
  remainingRecords: number,
  signal?: AbortSignal,
): Promise<UpstreamPage & { pageCount: number; byteLength: number }> {
  const url = catalogPageUrl(upstream, page);
  const response = await fetchFn(url, {
    redirect: 'error',
    signal:
      signal === undefined
        ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        : AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`upstream page ${page} answered ${response.status}`);
  }
  const maxBytes = Math.min(MAX_PAGE_BYTES, remainingBytes);
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`upstream page ${page} exceeds remaining byte budget ${maxBytes}`);
  }
  const bytes = await readCappedBody(response, maxBytes);
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const records = isRecord(body) ? body.data : undefined;
  const pagination = isRecord(body) && isRecord(body.meta) ? body.meta.pagination : undefined;
  const pageCount = isRecord(pagination) ? pagination.pageCount : undefined;
  if (
    !Array.isArray(records) ||
    typeof pageCount !== 'number' ||
    !Number.isInteger(pageCount) ||
    pageCount < 0
  ) {
    throw new Error(`upstream page ${page} lacks data or meta.pagination.pageCount`);
  }
  if (pageCount > MAX_PAGES) throw new Error(`upstream reports ${pageCount} pages, more than ${MAX_PAGES}`);
  if (records.length > Math.min(UPSTREAM_PAGE_SIZE, remainingRecords)) {
    throw new Error(`upstream page ${page} exceeds remaining record budget`);
  }
  return { page, body, records, pageCount, byteLength: bytes.byteLength };
}

/** Every catalogue page, from the first up to the `pageCount` the first page reports. Any failed or
 *  malformed page fails the whole download, so a partial catalogue never replaces a whole one. */
export async function fetchCatalogPages(
  fetchFn: Fetch,
  upstream: string,
  signal?: AbortSignal,
): Promise<UpstreamPage[]> {
  signal?.throwIfAborted();
  const first = await fetchPage(fetchFn, upstream, 1, MAX_CATALOG_BYTES, MAX_CATALOG_RECORDS, signal);
  const pages: UpstreamPage[] = [first];
  let remainingBytes = MAX_CATALOG_BYTES - first.byteLength;
  let remainingRecords = MAX_CATALOG_RECORDS - first.records.length;
  for (let page = 2; page <= first.pageCount; page++) {
    signal?.throwIfAborted();
    const next = await fetchPage(fetchFn, upstream, page, remainingBytes, remainingRecords, signal);
    remainingBytes -= next.byteLength;
    remainingRecords -= next.records.length;
    pages.push(next);
  }
  return pages.map(({ page, body, records }) => ({ page, body, records }));
}
