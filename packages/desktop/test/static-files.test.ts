import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileUnderRoot } from '../src/static-files.js';

/** The boundary between a crafted `app://` path and the rest of the user's disk. */
describe('fileUnderRoot', () => {
  let tmp: string;
  let root: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'opennorthland-static-'));
    root = join(tmp, 'root');
    await mkdir(join(root, 'maps'), { recursive: true });
    await writeFile(join(root, 'maps', 'two words.json'), '{}');
    await writeFile(join(root, 'index.html'), '<!doctype html>');
    await writeFile(join(tmp, 'outside.txt'), 'x');
    await mkdir(`${root}-evil`, { recursive: true });
    await writeFile(join(`${root}-evil`, 'x.txt'), 'x');
  });

  afterEach(() => rm(tmp, { recursive: true, force: true }));

  it('resolves an existing file, percent-decoding the pathname and tolerating repeated slashes', async () => {
    const expected = join(root, 'maps', 'two words.json');
    expect(await fileUnderRoot(root, '/maps/two%20words.json')).toBe(expected);
    expect(await fileUnderRoot(root, '///maps/two words.json')).toBe(expected);
    expect(await fileUnderRoot(root, '/maps/../maps/two words.json')).toBe(expected);
  });

  it('rejects traversal out of the root even when the target exists', async () => {
    expect(await fileUnderRoot(root, '/../outside.txt')).toBeUndefined();
    expect(await fileUnderRoot(root, '/maps/../../outside.txt')).toBeUndefined();
    expect(await fileUnderRoot(root, '/%2e%2e/outside.txt')).toBeUndefined();
    expect(await fileUnderRoot(root, '/../root-evil/x.txt')).toBeUndefined();
  });

  it('rejects directories, absent files and malformed percent sequences', async () => {
    expect(await fileUnderRoot(root, '/')).toBeUndefined();
    expect(await fileUnderRoot(root, '/maps')).toBeUndefined();
    expect(await fileUnderRoot(root, '/maps/missing.json')).toBeUndefined();
    expect(await fileUnderRoot(root, '/maps/%zz.json')).toBeUndefined();
  });
});
