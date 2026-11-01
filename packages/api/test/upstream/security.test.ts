import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyFile, normalizeRecords } from '../../src/catalog/normalize.js';
import { syncThumbnails } from '../../src/catalog/thumbnails.js';
import { downloadArchive } from '../../src/conversion/download.js';
import { DataStore } from '../../src/store.js';
import { fetchCatalogPages } from '../../src/upstream/strapi.js';
import { ACCEPTED_RECORDS, UPSTREAM } from '../support/strapi-fixture.js';

describe('automatic upstream fetch policy', () => {
  it('allows exact trusted origins and rejects screenshot credentials, schemes and other origins', () => {
    for (const url of [
      'http://127.0.0.1/internal',
      '//private.test/internal',
      'https://culturesnation.pl:444/image.png',
      'http://culturesnation.pl/image.png',
      'https://user:password@culturesnation.pl/image.png',
      'data:image/png;base64,AA==',
      'file:///etc/passwd',
    ]) {
      const result = normalizeRecords([{ ...ACCEPTED_RECORDS[0], screenshot: { url } }], UPSTREAM);
      expect(result.records[0]?.screenshotUrl, url).toBeNull();
    }
    for (const url of [
      '/uploads/image.png',
      'https://culturesnation.pl/image.png',
      'https://www.culturesnation.pl/image.png',
      'https://api.culturesnation.pl/image.png',
    ]) {
      const result = normalizeRecords([{ ...ACCEPTED_RECORDS[0], screenshot: { url } }], UPSTREAM);
      expect(result.records[0]?.screenshotUrl).toBe(new URL(url, UPSTREAM).toString());
    }
    expect(classifyFile('https://user:password@culturesnation.pl/file.zip', UPSTREAM)).toBeNull();
    expect(classifyFile('https://culturesnation.pl:444/file.zip', UPSTREAM)?.kind).toBe('external');
    expect(classifyFile('http://culturesnation.pl/file.zip', UPSTREAM)?.kind).toBe('external');
    expect(classifyFile('http://localhost:8791/file.zip', 'http://localhost:8791')).toEqual({
      kind: 'archive',
    });
    expect(classifyFile('https://localhost:8791/file.zip', 'http://localhost:8791')?.kind).toBe('external');
  });

  it('follows redirects for archives, but not for catalogue pages or thumbnails', async () => {
    let targetRequests = 0;
    const target = createServer((_request, response) => {
      targetRequests += 1;
      response.writeHead(200, { 'content-type': 'image/png' }).end('private bytes');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (address === null || typeof address === 'string') throw new Error('no TCP address');
    const redirect = createServer((_request, response) => {
      response
        .writeHead(302, {
          location: `http://127.0.0.1:${address.port}/private`,
        })
        .end();
    });
    const loop = createServer((_request, response) => {
      response.writeHead(302, { location: '/loop' }).end();
    });
    const directory = await mkdtemp(join(tmpdir(), 'api-fetch-policy-'));
    try {
      await new Promise<void>((resolve) => redirect.listen(0, '127.0.0.1', resolve));
      const redirectAddress = redirect.address();
      if (redirectAddress === null || typeof redirectAddress === 'string') throw new Error('no TCP address');
      const upstream = `http://127.0.0.1:${redirectAddress.port}`;
      await new Promise<void>((resolve) => loop.listen(0, '127.0.0.1', resolve));
      const loopAddress = loop.address();
      if (loopAddress === null || typeof loopAddress === 'string') throw new Error('no TCP address');
      await expect(fetchCatalogPages(fetch, upstream)).rejects.toThrow();
      // An archive follows the hop a download script makes before it hands the file out.
      await expect(
        downloadArchive(fetch, `${upstream}/map.zip`, {
          maxBytes: 1024,
          timeoutMs: 1000,
        }),
      ).resolves.toEqual(new TextEncoder().encode('private bytes'));
      expect(targetRequests).toBe(1);
      // A host that sends the download around in circles is refused, not followed without end.
      await expect(
        downloadArchive(fetch, `http://127.0.0.1:${loopAddress.port}/map.zip`, {
          maxBytes: 1024,
          timeoutMs: 1000,
        }),
      ).rejects.toThrow('redirects');
      const store = new DataStore(directory);
      await store.init();
      const records = normalizeRecords(
        [{ ...ACCEPTED_RECORDS[0], screenshot: { url: '/redirect.png' } }],
        upstream,
      ).records;
      const catalog = await syncThumbnails(fetch, store, records, () => undefined);
      expect(catalog[0]?.thumbnail).toBeUndefined();
      expect(targetRequests).toBe(1);
    } finally {
      target.closeAllConnections();
      redirect.closeAllConnections();
      loop.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => target.close(() => resolve())),
        new Promise<void>((resolve) => redirect.close(() => resolve())),
        new Promise<void>((resolve) => loop.close(() => resolve())),
        rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
});
