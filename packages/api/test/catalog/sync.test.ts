import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CatalogSync, syncCatalog } from '../../src/catalog/sync.js';
import { DataStore } from '../../src/store.js';
import { FakeMapdb, MAPDB_UPSTREAM, mapdbMapRow } from '../support/mapdb-fixture.js';
import {
  ACCEPTED_RECORDS,
  FakeUpstream,
  PNG_BYTES,
  REFUSED_RECORDS,
  strapiRecord,
  UPSTREAM,
} from '../support/strapi-fixture.js';

const HOUR_MS = 3_600_000;
/** The bytes and the meta beside them. */
const FILES_PER_THUMBNAIL = 2;

describe('syncCatalog', () => {
  let dir: string;
  let store: DataStore;
  const events: string[] = [];
  const log = (event: string) => {
    events.push(event);
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-sync-'));
    store = new DataStore(dir);
    await store.init();
    events.length = 0;
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const readCatalog = async () =>
    Catalog.parse(JSON.parse(await readFile(join(dir, 'catalog.json'), 'utf8')));

  it('writes the catalogue, the raw pages and the thumbnails', async () => {
    const upstream = new FakeUpstream([
      [...ACCEPTED_RECORDS.slice(0, 3), ...REFUSED_RECORDS],
      ACCEPTED_RECORDS.slice(3),
    ]);
    const synced = await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const catalog = await readCatalog();
    expect(catalog).toHaveLength(ACCEPTED_RECORDS.length);
    expect(synced.catalog).toEqual(catalog);
    expect([...synced.downloads.keys()]).toEqual(
      catalog.filter((entry) => entry.file.kind !== 'external').map((entry) => entry.id),
    );
    expect((await readdir(join(dir, 'raw'))).sort()).toEqual(['1.json', '2.json']);
    expect(events.filter((event) => event === 'record skipped')).toHaveLength(REFUSED_RECORDS.length);
    const withThumbnail = catalog.filter((entry) => entry.thumbnail !== undefined);
    expect(withThumbnail).toHaveLength(ACCEPTED_RECORDS.length - 1);
    const first = withThumbnail[0];
    const pngHash = createHash('sha256').update(PNG_BYTES).digest('hex');
    expect(first?.thumbnail).toBe(`/v1/maps/${first?.id}/thumbnail?v=${pngHash}`);
    expect(await store.readThumbnail(first?.id ?? '')).toEqual({
      bytes: PNG_BYTES,
      contentType: 'image/png',
    });
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps ids and the catalogue bytes stable across syncs of the same input', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    const first = await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const second = await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    expect(second.catalog.map(({ id }) => id)).toEqual(first.catalog.map(({ id }) => id));
    expect(JSON.stringify(second.catalog)).toBe(JSON.stringify(first.catalog));
  });

  it('fetches a thumbnail once and again only when updatedAt changes', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const fetchedFirst = upstream.thumbnailRequests().length;
    expect(fetchedFirst).toBe(ACCEPTED_RECORDS.length - 1);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    expect(upstream.thumbnailRequests()).toHaveLength(fetchedFirst);
    const changed = strapiRecord({
      id: 11,
      documentId: 'AbCdEf0123456789ghijklmn',
      title: 'Frozen Fjord',
      category: 'Mapy Singleplayer',
      fileUrl: 'https://culturesnation.pl/downloads/frozen_fjord.rar',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    upstream.pages = [[changed, ...ACCEPTED_RECORDS.slice(1)]];
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    expect(upstream.thumbnailRequests()).toHaveLength(fetchedFirst + 1);
  });

  it('drops the raw pages and thumbnails of a shrunk catalogue', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS.slice(0, 2), ACCEPTED_RECORDS.slice(2)]);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    upstream.pages = [ACCEPTED_RECORDS.slice(0, 1)];
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    expect(await readdir(join(dir, 'raw'))).toEqual(['1.json']);
    expect(await readdir(join(dir, 'thumbnails'))).toHaveLength(2);
  });

  it('refuses a thumbnail whose bytes another write replaced after its meta', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    const { catalog } = await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const id = catalog.find((entry) => entry.thumbnail !== undefined)?.id ?? '';
    await writeFile(join(dir, 'thumbnails', id), Buffer.from('newer bytes'));
    expect(await store.readThumbnail(id)).toBeNull();
  });

  it('keeps a non-empty catalogue when the upstream suddenly lists nothing', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const before = await readFile(join(dir, 'catalog.json'), 'utf8');
    upstream.pages = [];
    await expect(syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log })).rejects.toThrow(
      /lists no map/,
    );
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe(before);
    expect(await readdir(join(dir, 'thumbnails'))).toHaveLength(
      FILES_PER_THUMBNAIL * (ACCEPTED_RECORDS.length - 1),
    );
  });

  it('keeps the last good catalogue and raw page when a replacement exceeds the page budget', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const catalog = await readFile(join(dir, 'catalog.json'), 'utf8');
    const raw = await readFile(join(dir, 'raw', '1.json'), 'utf8');
    const fetch = async () => new Response('', { headers: { 'content-length': String(3 * 1024 * 1024) } });
    await expect(syncCatalog({ fetch, upstream: UPSTREAM, store, log })).rejects.toThrow(/byte budget/);
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe(catalog);
    expect(await readFile(join(dir, 'raw', '1.json'), 'utf8')).toBe(raw);
  });

  it('keeps the last good catalogue when the upstream fails', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    await syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log });
    const before = await readFile(join(dir, 'catalog.json'), 'utf8');
    upstream.failing = true;
    await expect(syncCatalog({ fetch: upstream.fetch, upstream: UPSTREAM, store, log })).rejects.toThrow();
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe(before);
    expect(await readdir(join(dir, 'raw'))).toEqual(['1.json']);
  });

  it('cancels an oversized chunked thumbnail before consuming the remaining body', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS.slice(0, 1)]);
    let cancelled = false;
    let chunks = 0;
    const fetch = async (url: string): Promise<Response> => {
      if (!new URL(url).pathname.startsWith('/uploads/')) return upstream.fetch(url);
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            chunks += 1;
            controller.enqueue(new Uint8Array(1024 * 1024));
            if (chunks === 20) controller.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'image/png' } },
      );
    };
    const synced = await syncCatalog({ fetch, upstream: UPSTREAM, store, log });
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThanOrEqual(4);
    expect(synced.catalog[0]?.thumbnail).toBeUndefined();
    expect(await readdir(join(dir, 'thumbnails'))).toEqual([]);
  });

  it('merges both sources, keeps the mapdb records and re-dates nothing on the next sync', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS.slice(0, 1)]);
    const mapdb = new FakeMapdb([[mapdbMapRow({ title: 'Wareham', authorId: 178 })]]);
    const fetch = async (url: string, init?: { readonly body?: string }): Promise<Response> => {
      if (new URL(url).origin === MAPDB_UPSTREAM) {
        if (new URL(url).pathname.startsWith('/femaps/Screens/'))
          return new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } });
        return mapdb.fetch(url, init);
      }
      return upstream.fetch(url);
    };
    const first = await syncCatalog({ fetch, upstream: UPSTREAM, mapdbUpstream: MAPDB_UPSTREAM, store, log });
    expect(first.catalog.map(({ id }) => id.startsWith('wt-'))).toContain(true);
    const wt = first.catalog.find(({ id }) => id.startsWith('wt-'));
    expect(first.downloads.get(wt?.id ?? ''))?.toContain('/mapdb/download.php?datei=');
    expect(await store.readRawMapdbRecords()).toHaveLength(1);
    const pngHash = createHash('sha256').update(PNG_BYTES).digest('hex');
    expect(wt?.thumbnail).toBe(`/v1/maps/${wt?.id}/thumbnail?v=${pngHash}`);

    // A second sync of the same list keeps every date, so thumbnails and downloads stay current.
    mapdb.reset();
    const second = await syncCatalog({
      fetch,
      upstream: UPSTREAM,
      mapdbUpstream: MAPDB_UPSTREAM,
      store,
      log,
    });
    expect(JSON.stringify(second.catalog)).toBe(JSON.stringify(first.catalog));
    expect(second.downloads.get(wt?.id ?? ''))?.toBe(first.downloads.get(wt?.id ?? ''));
  });

  it('keeps the last good catalogue when the mapdb source fails', async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    const mapdb = new FakeMapdb([[mapdbMapRow({ title: 'Wareham' })]]);
    const fetch = async (url: string, init?: { readonly body?: string }): Promise<Response> =>
      new URL(url).origin === MAPDB_UPSTREAM ? mapdb.fetch(url, init) : upstream.fetch(url);
    await syncCatalog({ fetch, upstream: UPSTREAM, mapdbUpstream: MAPDB_UPSTREAM, store, log });
    const before = await readFile(join(dir, 'catalog.json'), 'utf8');
    // The fake's one page is spent: the next sync's mapdb request answers 404.
    await expect(
      syncCatalog({ fetch, upstream: UPSTREAM, mapdbUpstream: MAPDB_UPSTREAM, store, log }),
    ).rejects.toThrow(/404/);
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe(before);
  });
});

describe('CatalogSync', () => {
  it('publishes a good run, logs a failed one and stops cleanly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'on-api-loop-'));
    const store = new DataStore(dir);
    await store.init();
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    const events: string[] = [];
    const published: number[] = [];
    let finished: () => void = () => undefined;
    const goodDone = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const options = {
      fetch: upstream.fetch,
      upstream: UPSTREAM,
      store,
      log: (event: string) => {
        events.push(event);
        if (event === 'sync done' || event === 'sync failed') finished();
      },
    };
    const good = new CatalogSync(options, HOUR_MS, (synced) => published.push(synced.catalog.length));
    good.start();
    await goodDone;
    await good.stop();
    expect(published).toEqual([ACCEPTED_RECORDS.length]);
    upstream.failing = true;
    const bad = new CatalogSync(options, HOUR_MS, (synced) => published.push(synced.catalog.length));
    const badDone = new Promise<void>((resolve) => {
      finished = resolve;
    });
    bad.start();
    await badDone;
    await bad.stop();
    expect(published).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining(['sync done', 'sync failed']));
    await rm(dir, { recursive: true, force: true });
  });
});

describe('CatalogSync cancellation', () => {
  let dir: string;
  let store: DataStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-sync-stop-'));
    store = new DataStore(dir);
    await store.init();
    await store.writeCatalog('[]');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('aborts a stalled page instead of waiting for its timeout', async () => {
    let began: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let aborted = false;
    let published = false;
    const sync = new CatalogSync(
      {
        store,
        upstream: UPSTREAM,
        log: () => undefined,
        fetch: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new Error('aborted'));
              },
              { once: true },
            );
            began();
          }),
      },
      HOUR_MS,
      () => {
        published = true;
      },
    );
    sync.start();
    await started;
    await sync.stop();
    expect(aborted).toBe(true);
    expect(published).toBe(false);
    expect(await readdir(join(dir, 'raw'))).toEqual([]);
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe('[]');
  });

  it('cancels active thumbnails, leaves queued ones unfetched and preserves the catalogue', async () => {
    const upstream = new FakeUpstream([
      Array.from({ length: 10 }, (_, index) =>
        strapiRecord({
          id: index,
          documentId: `map${index}`,
          title: `Map ${index}`,
          category: 'Mapy Singleplayer',
          fileUrl: `${UPSTREAM}/map${index}.zip`,
        }),
      ),
    ]);
    let began: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let requested = 0;
    let aborted = 0;
    let published = false;
    const sync = new CatalogSync(
      {
        store,
        upstream: UPSTREAM,
        log: () => undefined,
        fetch: async (url, init) => {
          if (!new URL(url).pathname.startsWith('/uploads/')) return upstream.fetch(url);
          requested += 1;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted += 1;
                reject(new Error('aborted'));
              },
              { once: true },
            );
            if (requested === 4) began();
          });
        },
      },
      HOUR_MS,
      () => {
        published = true;
      },
    );
    sync.start();
    await started;
    await sync.stop();
    expect({ requested, aborted, published }).toEqual({ requested: 4, aborted: 4, published: false });
    expect(await readdir(join(dir, 'thumbnails'))).toEqual([]);
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe('[]');
  });
});
