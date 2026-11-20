import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NEWS_FILE_MAX_BYTES } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NEWS_FILE_NAME } from '../../src/news/document.js';
import { NewsFile } from '../../src/news/news-file.js';
import { type ApiServer, startApiServer } from '../../src/server.js';
import { DataStore } from '../../src/store.js';

const FIRST = { schema: 1, entries: [{ title: { eng: 'Showmatch tonight' } }] };
const SECOND = { schema: 1, entries: [{ title: { eng: 'Patch notes' } }, { title: { eng: 'Tournament' } }] };
const NOT_MODIFIED = 304;

describe('news endpoint', () => {
  let dir: string;
  let file: string;
  let server: ApiServer;
  let base: string;
  let logged: { readonly event: string; readonly fields: Record<string, unknown> | undefined }[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-news-'));
    file = join(dir, NEWS_FILE_NAME);
    logged = [];
    const log = (event: string, fields?: Record<string, unknown>): void => {
      logged.push({ event, fields });
    };
    const store = new DataStore(dir);
    await store.init();
    server = await startApiServer({ port: 0, host: '127.0.0.1', store, news: new NewsFile(file, log) });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  /** Replaces the file the way the deployment does: a complete file renamed over the old one. */
  const publish = async (value: unknown): Promise<void> => {
    const next = `${file}.next`;
    await writeFile(next, typeof value === 'string' ? value : JSON.stringify(value));
    await rename(next, file);
  };
  const news = async (): Promise<unknown> => (await fetch(`${base}/v1/news`)).json();

  it('serves no news while the file is missing, before any catalogue sync', async () => {
    const response = await fetch(`${base}/v1/news`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ schema: 1, entries: [] });
  });

  it('picks up a replaced file on the next request and revalidates with its ETag', async () => {
    await publish(FIRST);
    const first = await fetch(`${base}/v1/news`);
    expect(await first.json()).toEqual(FIRST);
    const etag = first.headers.get('etag') ?? '';
    const held = await fetch(`${base}/v1/news`, { headers: { 'if-none-match': etag } });
    expect(held.status).toBe(NOT_MODIFIED);

    await publish(SECOND);
    const head = await fetch(`${base}/v1/news`, { method: 'HEAD', headers: { 'if-none-match': etag } });
    expect(head.status).toBe(200);
    expect(head.headers.get('etag')).not.toBe(etag);
    expect(await head.text()).toBe('');
    expect(await news()).toEqual(SECOND);
  });

  it('keeps the last good news over an invalid file and logs it once', async () => {
    await publish(FIRST);
    expect(await news()).toEqual(FIRST);
    await publish({ schema: 1, entries: [{ title: { pol: 'Bez angielskiego' } }] });
    expect(await news()).toEqual(FIRST);
    expect(await news()).toEqual(FIRST);
    await publish(' '.repeat(NEWS_FILE_MAX_BYTES + 1));
    expect(await news()).toEqual(FIRST);
    expect(logged.map(({ event, fields }) => [event, String(fields?.reason)])).toEqual([
      ['news refused', expect.stringMatching(/^entries\.0\.title\.eng: /)],
      ['news refused', expect.stringContaining(`over the ${NEWS_FILE_MAX_BYTES}-byte cap`)],
    ]);
  });
});
