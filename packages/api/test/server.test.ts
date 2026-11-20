import { type FileHandle, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CatalogBrowse, CatalogEntry } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogSnapshot } from '../src/catalog/snapshot.js';
import { syncCatalog } from '../src/catalog/sync.js';
import type { KeptFile } from '../src/http/sources.js';
import { type ApiServer, startApiServer } from '../src/server.js';
import { DataStore } from '../src/store.js';
import { ACCEPTED_RECORDS, FakeUpstream, PNG_BYTES, UPSTREAM } from './support/strapi-fixture.js';

const SYNCED_AT = new Date('2024-05-01T00:00:00.000Z');
const LATER_SECONDS = 90;
const LATER = new Date(SYNCED_AT.getTime() + LATER_SECONDS * 1000);
const KEPT_BYTES = Buffer.from('kept archive bytes');
const KEPT_SHA256 = 'ab'.repeat(32);

describe('api server', () => {
  let dir: string;
  let store: DataStore;
  let server: ApiServer;
  let base: string;
  /** What the stub kept-file source answers, by entry id. */
  let kept: Map<string, Omit<KeptFile, 'handle'>>;
  let opened: FileHandle[];

  beforeEach(async () => {
    kept = new Map();
    opened = [];
    dir = await mkdtemp(join(tmpdir(), 'on-api-server-'));
    await writeFile(join(dir, 'kept.zip'), KEPT_BYTES);
    store = new DataStore(dir);
    await store.init();
    server = await startApiServer({
      port: 0,
      host: '127.0.0.1',
      build: 'test-build',
      gameVersion: '0.8.0',
      store,
      files: {
        keptFile: async (id) => {
          const meta = kept.get(id);
          if (meta === undefined) return null;
          const handle = await open(join(dir, 'kept.zip'));
          opened.push(handle);
          return { ...meta, handle };
        },
      },
      now: () => LATER,
    });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const sync = async () => {
    const upstream = new FakeUpstream([ACCEPTED_RECORDS]);
    const synced = await syncCatalog(
      { fetch: upstream.fetch, upstream: UPSTREAM, store, log: () => undefined },
      () => SYNCED_AT,
    );
    server.publish(catalogSnapshot(synced.catalog, synced.syncedAt));
  };

  it('fails the health check until the first sync, then reports it', async () => {
    const before = await fetch(`${base}/healthz`);
    expect(before.status).toBe(503);
    expect(await before.json()).toEqual({
      ok: false,
      build: 'test-build',
      gameVersion: '0.8.0',
      lastSyncAt: null,
      staleSeconds: null,
      entryCount: 0,
      converted: 0,
      pending: 0,
      failed: 0,
      reports: null,
    });
    expect((await fetch(`${base}/v1/catalog`)).status).toBe(503);
    await sync();
    const after = await fetch(`${base}/healthz`);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({
      ok: true,
      build: 'test-build',
      gameVersion: '0.8.0',
      lastSyncAt: SYNCED_AT.toISOString(),
      staleSeconds: LATER_SECONDS,
      entryCount: ACCEPTED_RECORDS.length,
      converted: 0,
      pending: 0,
      failed: 0,
      reports: null,
    });
  });

  it('serves a catalogue and entries that parse with the shared schema, with CORS and caching', async () => {
    await sync();
    const response = await fetch(`${base}/v1/catalog`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-expose-headers')).toBe('ETag, x-game-version');
    expect(response.headers.get('x-game-version')).toBe('0.8.0');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const catalog = CatalogBrowse.parse(await response.json());
    expect(catalog).toHaveLength(ACCEPTED_RECORDS.length);
    const first = catalog[0];
    if (first === undefined) throw new Error('empty catalogue');
    const one = await fetch(`${base}/v1/maps/${first.id}`);
    expect(one.headers.get('access-control-allow-origin')).toBe('*');
    expect(CatalogEntry.parse(await one.json())).toEqual(first);
  });

  it('answers 304 to a matching If-None-Match and keeps the ETag across a resync', async () => {
    await sync();
    const first = await fetch(`${base}/v1/catalog`);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const cached = await fetch(`${base}/v1/catalog`, { headers: { 'if-none-match': etag ?? '' } });
    expect(cached.status).toBe(304);
    expect(cached.headers.get('access-control-allow-origin')).toBe('*');
    await sync();
    expect((await fetch(`${base}/v1/catalog`)).headers.get('etag')).toBe(etag);
  });

  it('compresses catalogue responses with representation validators and respects gzip refusal', async () => {
    await sync();
    const read = (headers: Record<string, string>, method = 'GET') =>
      new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; bytes: Buffer }>(
        (resolve, reject) => {
          const request = httpRequest(`${base}/v1/catalog`, { method, headers }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                bytes: Buffer.concat(chunks),
              }),
            );
          });
          request.on('error', reject);
          request.end();
        },
      );
    const plain = await read({ 'accept-encoding': 'gzip;q=0, *;q=1' });
    const zipped = await read({ 'accept-encoding': 'gzip' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.headers.vary).toBe('Accept-Encoding');
    expect(gunzipSync(zipped.bytes)).toEqual(plain.bytes);
    expect(zipped.headers.etag).not.toBe(plain.headers.etag);
    const headers = { 'accept-encoding': 'gzip', 'if-none-match': String(zipped.headers.etag) };
    const cached = await read(headers);
    expect(cached.status).toBe(304);
    expect(cached.bytes).toHaveLength(0);
    const head = await read({ 'accept-encoding': 'gzip' }, 'HEAD');
    expect(head.bytes).toHaveLength(0);
    expect(Number(head.headers['content-length'])).toBe(zipped.bytes.length);
  });

  it('serves stored thumbnails with their type and 404 for maps without one', async () => {
    await sync();
    const catalog = CatalogBrowse.parse(await (await fetch(`${base}/v1/catalog`)).json());
    const withShot = catalog.find((entry) => entry.thumbnail !== undefined);
    const withoutShot = catalog.find((entry) => entry.thumbnail === undefined);
    const image = await fetch(`${base}${withShot?.thumbnail}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('access-control-allow-origin')).toBe('*');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG_BYTES);
    const missing = await fetch(`${base}/v1/maps/${withoutShot?.id}/thumbnail`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'no thumbnail' });
  });

  it('allows GET and HEAD only and answers misses as JSON errors', async () => {
    await sync();
    const post = await fetch(`${base}/v1/catalog`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    expect(post.headers.get('access-control-allow-origin')).toBe('*');
    expect(await post.json()).toEqual({ error: 'method not allowed' });
    const head = await fetch(`${base}/v1/catalog`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const unknown = await fetch(`${base}/v1/maps/cn-nothing`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'no such map' });
    expect((await fetch(`${base}/v1/maps/..%2Fcatalog.json/thumbnail`)).status).toBe(404);
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
  });

  it('serves a kept file as an attachment with a hash validator, and 404 without one', async () => {
    await sync();
    const catalog = CatalogBrowse.parse(await (await fetch(`${base}/v1/catalog`)).json());
    const [first, second] = catalog;
    if (first === undefined || second === undefined) throw new Error('catalogue too small');
    const file = { sha256: KEPT_SHA256, name: 'Wyspa "Ł" (v2).rar' };
    kept.set(first.id, file);
    kept.set('cn-not-listed', file);

    const response = await fetch(`${base}/v1/maps/${first.id}/file?v=${KEPT_SHA256}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="Wyspa ___ (v2).rar"; filename*=UTF-8''Wyspa%20%22%C5%81%22%20%28v2%29.rar`,
    );
    expect(response.headers.get('etag')).toBe(`"${KEPT_SHA256}"`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(KEPT_BYTES);
    await expect.poll(() => opened.every((handle) => handle.fd === -1)).toBe(true);

    const head = await fetch(`${base}/v1/maps/${first.id}/file`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(KEPT_BYTES.length));
    expect(await head.text()).toBe('');
    await expect.poll(() => opened.every((handle) => handle.fd === -1)).toBe(true);
    const cached = await fetch(`${base}/v1/maps/${first.id}/file`, {
      headers: { 'if-none-match': `"${KEPT_SHA256}"` },
    });
    expect(cached.status).toBe(304);
    await expect.poll(() => opened.every((handle) => handle.fd === -1)).toBe(true);

    for (const id of [second.id, 'cn-not-listed']) {
      const missing = await fetch(`${base}/v1/maps/${id}/file`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'no file' });
    }
  });

  it('answers a CORS preflight on /v1 so a browser may send If-None-Match', async () => {
    const preflight = await fetch(`${base}/v1/catalog`, {
      method: 'OPTIONS',
      headers: { origin: 'app://open-northland', 'access-control-request-headers': 'if-none-match' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, HEAD');
    expect(preflight.headers.get('access-control-allow-headers')).toBe('If-None-Match');
    expect(Number(preflight.headers.get('access-control-max-age'))).toBeGreaterThan(0);
    expect((await fetch(`${base}/healthz`, { method: 'OPTIONS' })).status).toBe(405);
  });

  it('answers a raw path traversal attempt with a miss', async () => {
    await sync();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: server.port, path: '/v1/maps/../catalog.json/thumbnail' },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(404);
  });
});
