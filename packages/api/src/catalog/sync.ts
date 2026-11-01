import type { Catalog } from '@open-northland/data';
import { errorMessage } from '../log.js';
import type { DataStore } from '../store.js';
import { fetchMapdbPages } from '../upstream/mapdb.js';
import { type Fetch, fetchCatalogPages } from '../upstream/strapi.js';
import { type NormalizedRecord, normalizeRecords } from './normalize.js';
import { firstSeenDates, normalizeMapdbRecords } from './normalize-mapdb.js';
import { parseCatalog } from './snapshot.js';
import { type Log, syncThumbnails } from './thumbnails.js';

export interface SyncOptions {
  readonly fetch: Fetch;
  readonly upstream: string;
  /** The wikinger-tommy.de mapdb origin, or null/absent when a deployment serves the other source
   *  alone. */
  readonly mapdbUpstream?: string | null;
  readonly store: DataStore;
  readonly log: Log;
  readonly signal?: AbortSignal;
}

/** A catalogue as one sync left it, with the download URL of every entry that has a file to convert. */
export interface SyncedCatalog {
  readonly catalog: Catalog;
  readonly downloads: ReadonlyMap<string, string>;
  readonly syncedAt: Date;
}

/** Entry id to download URL, for the records whose file sits on the catalogue host. */
export function downloadsOf(records: readonly NormalizedRecord[]): Map<string, string> {
  const downloads = new Map<string, string>();
  for (const { entry, fileUrl } of records) if (fileUrl !== null) downloads.set(entry.id, fileUrl);
  return downloads;
}

async function storedEntryCount(store: DataStore): Promise<number> {
  const stored = await store.readCatalog();
  if (stored === null) return 0;
  const parsed: unknown = JSON.parse(stored.text);
  return Array.isArray(parsed) ? parsed.length : 0;
}

/** The stored catalogue's entries, or none when its text no longer parses; its dates feed the
 *  mapdb's first-seen dates. */
async function storedEntries(store: DataStore, log: Log): Promise<Catalog> {
  const stored = await store.readCatalog();
  if (stored === null) return [];
  try {
    return parseCatalog(stored.text);
  } catch (error) {
    log('stored catalogue refused', { error: errorMessage(error) });
    return [];
  }
}

/** Both sources' records in one catalogue: ids are unique across them, the rest sorted by id. */
function mergeRecords(
  sources: readonly (readonly NormalizedRecord[])[],
  log: Log,
): readonly NormalizedRecord[] {
  const byId = new Map<string, NormalizedRecord>();
  for (const records of sources) {
    for (const record of records) {
      if (byId.has(record.entry.id)) {
        log('record skipped', { upstreamId: record.entry.source.id, reason: 'duplicate id' });
        continue;
      }
      byId.set(record.entry.id, record);
    }
  }
  return [...byId.values()].sort((a, b) => (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
}

/** One sync: download every page of both sources, normalize, keep the raw pages and the mapdb
 *  records, refresh thumbnails and replace `catalog.json`. Throws before touching the data dir when
 *  either source fails or lists no map while a non-empty catalogue is stored, so the last good
 *  catalogue stays. */
export async function syncCatalog(
  options: SyncOptions,
  now: () => Date = () => new Date(),
): Promise<SyncedCatalog> {
  const { fetch, upstream, store, log, signal } = options;
  const mapdbUpstream = options.mapdbUpstream ?? null;
  const pages = await fetchCatalogPages(fetch, upstream, signal);
  const { records: siteRecords, skipped } = normalizeRecords(
    pages.flatMap(({ records: pageRecords }) => pageRecords),
    upstream,
  );
  for (const { upstreamId, reason } of skipped) log('record skipped', { upstreamId, reason });

  let mapdbRecords: readonly NormalizedRecord[] = [];
  let mapdbRaw: readonly unknown[] = [];
  if (mapdbUpstream !== null) {
    const mapdbPages = await fetchMapdbPages(fetch, mapdbUpstream, signal);
    const { records: normalized, skipped: mapdbSkipped } = normalizeMapdbRecords(
      mapdbPages,
      mapdbUpstream,
      firstSeenDates(await storedEntries(store, log)),
      () => now().toISOString(),
    );
    for (const { upstreamId, reason } of mapdbSkipped) log('mapdb record skipped', { upstreamId, reason });
    mapdbRecords = normalized;
    mapdbRaw = mapdbPages;
  }

  const records = mergeRecords([siteRecords, mapdbRecords], log);
  if (records.length === 0 && (await storedEntryCount(store)) > 0) {
    throw new Error('upstream lists no map; the stored catalogue stays');
  }
  signal?.throwIfAborted();
  await store.writeRawPages(pages);
  if (mapdbUpstream !== null) await store.writeRawMapdbRecords(mapdbRaw);
  const catalog: Catalog = await syncThumbnails(fetch, store, records, log, signal);
  signal?.throwIfAborted();
  await store.writeCatalog(JSON.stringify(catalog));
  return { catalog, downloads: downloadsOf(records), syncedAt: now() };
}

/** Runs `syncCatalog` at start and then `intervalMs` after each run ends, handing each good result to
 *  `publish`. A failed run is logged and the previous catalogue keeps serving. */
export class CatalogSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly options: SyncOptions,
    private readonly intervalMs: number,
    private readonly publish: (synced: SyncedCatalog) => void,
  ) {}

  start(): void {
    this.running = this.run();
  }

  /** Cancels upstream work and waits for in-flight storage; no further sync starts. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private async run(): Promise<void> {
    const startedAt = performance.now();
    try {
      const signal =
        this.options.signal === undefined
          ? this.abort.signal
          : AbortSignal.any([this.abort.signal, this.options.signal]);
      const synced = await syncCatalog({ ...this.options, signal });
      if (!this.stopped) this.publish(synced);
      this.options.log('sync done', {
        entries: synced.catalog.length,
        ms: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (!this.stopped) this.options.log('sync failed', { error: errorMessage(error) });
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => {
        this.running = this.run();
      }, this.intervalMs);
      this.timer.unref();
    }
  }
}
