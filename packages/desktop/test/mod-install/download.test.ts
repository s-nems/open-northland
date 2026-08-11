import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadCnModZip } from '../../src/mod-install/download.js';
import { fetchStub, fileResponse } from '../support/fetch-stub.js';
import { makeTempDir, type TempDir } from '../support/temp-dir.js';

describe('downloadCnModZip', () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('mod-download');
  });
  afterEach(() => tmp.cleanup());

  it('streams the archive to disk and returns its sha256', async () => {
    const bytes = Uint8Array.from([80, 75, 3, 4]);
    const fetchFn = fetchStub({
      'https://cn.example/cnmod.zip': () => fileResponse(bytes, 'https://cn.example/cnmod.zip'),
    });
    const dest = join(tmp.path, 'mod.zip');
    const events: unknown[] = [];
    const sha = await downloadCnModZip(dest, (e) => events.push(e), {
      fetchFn,
      url: 'https://cn.example/cnmod.zip',
    });
    expect(Array.from(await readFile(dest))).toEqual(Array.from(bytes));
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(events.length).toBeGreaterThan(0);
  });

  it('fetches the project origin when no url is given', async () => {
    const url = 'https://game.opennorthland.org/cnmod.zip';
    const fetchFn = fetchStub({ [url]: () => fileResponse(Uint8Array.from([1, 2, 3]), url) });
    const dest = join(tmp.path, 'mod.zip');
    await downloadCnModZip(dest, () => undefined, { fetchFn });
    expect(Array.from(await readFile(dest))).toEqual([1, 2, 3]);
  });

  it('fails a non-2xx answer instead of writing the error page to disk', async () => {
    const url = 'https://cn.example/cnmod.zip';
    const fetchFn = fetchStub({
      [url]: () => new Response('not here', { status: 404, statusText: 'Not Found' }),
    });
    await expect(
      downloadCnModZip(join(tmp.path, 'mod.zip'), () => undefined, { fetchFn, url }),
    ).rejects.toThrow(/answered 404 Not Found/);
  });
});
