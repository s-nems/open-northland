import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { byteRange, contentFile, isContentPath } from '../vite/serve-content.js';

/** The dev server's boundary between a crafted URL and the rest of the developer's disk. */
describe('contentFile', () => {
  let tmp: string;
  let root: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'opennorthland-serve-content-'));
    root = join(tmp, 'content');
    await mkdir(join(root, 'maps'), { recursive: true });
    await writeFile(join(root, 'maps', 'two words.json'), '{}');
    await writeFile(join(tmp, 'outside.txt'), 'x');
    await mkdir(`${root}-evil`, { recursive: true });
    await writeFile(join(`${root}-evil`, 'x.txt'), 'x');
  });

  afterEach(() => rm(tmp, { recursive: true, force: true }));

  it('resolves an existing file, percent-decoding the pathname and tolerating repeated slashes', async () => {
    const expected = join(root, 'maps', 'two words.json');
    expect(await contentFile(root, '/maps/two%20words.json')).toBe(expected);
    expect(await contentFile(root, '///maps/two words.json')).toBe(expected);
    expect(await contentFile(root, '/maps/../maps/two words.json')).toBe(expected);
  });

  it('rejects traversal out of the root even when the target exists', async () => {
    expect(await contentFile(root, '/../outside.txt')).toBeUndefined();
    expect(await contentFile(root, '/maps/../../outside.txt')).toBeUndefined();
    expect(await contentFile(root, '/%2e%2e/outside.txt')).toBeUndefined();
    expect(await contentFile(root, '/../content-evil/x.txt')).toBeUndefined();
  });

  it('rejects directories, absent files and malformed percent sequences', async () => {
    expect(await contentFile(root, '/')).toBeUndefined();
    expect(await contentFile(root, '/maps')).toBeUndefined();
    expect(await contentFile(root, '/maps/missing.json')).toBeUndefined();
    expect(await contentFile(root, '/maps/%zz.json')).toBeUndefined();
  });
});

describe('isContentPath', () => {
  it('claims the listings and every served directory, so a miss there never falls back to index.html', () => {
    for (const path of ['/ir.json', '/maps-index.json', '/maps/missing.json', '/bobs/x.png'])
      expect(isContentPath(path)).toBe(true);
  });

  it('leaves the app and Vite paths to the server', () => {
    for (const path of ['/', '/index.html', '/src/main.ts', '/@vite/client', '/assets/x.png'])
      expect(isContentPath(path)).toBe(false);
  });
});

describe('byteRange', () => {
  const SIZE = 100;

  it('reads a bounded, an open and a suffix range, clamping the end to the file', () => {
    expect(byteRange('bytes=10-19', SIZE)).toEqual({ start: 10, end: 19 });
    expect(byteRange('bytes=90-', SIZE)).toEqual({ start: 90, end: 99 });
    expect(byteRange('bytes=-5', SIZE)).toEqual({ start: 95, end: 99 });
    expect(byteRange('bytes=50-500', SIZE)).toEqual({ start: 50, end: 99 });
  });

  it('serves the whole file without a single byte range', () => {
    expect(byteRange(undefined, SIZE)).toBeUndefined();
    expect(byteRange('bytes=0-1,5-6', SIZE)).toBeUndefined();
    expect(byteRange('items=0-1', SIZE)).toBeUndefined();
  });

  it('refuses a range past the end', () => {
    expect(byteRange('bytes=100-', SIZE)).toBe('unsatisfiable');
    expect(byteRange('bytes=20-10', SIZE)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', SIZE)).toBe('unsatisfiable');
  });
});
