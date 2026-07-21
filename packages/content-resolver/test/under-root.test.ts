import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveFileUnderRoot } from '../src/under-root.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';

/**
 * The containment rule (`src/under-root.ts`) both hosts sit on: the content routes and the desktop
 * shell's static page files. It is the only thing standing between a crafted request path and the
 * rest of the user's disk, so it is tested directly rather than only through its two callers.
 */
describe('resolveFileUnderRoot', () => {
  let tmp: TempDir;
  let root: string;

  beforeEach(async () => {
    tmp = await makeTempDir('under-root');
    root = join(tmp.path, 'root');
    await mkdir(join(root, 'sub'), { recursive: true });
    await writeFile(join(root, 'sub', 'inside.txt'), 'x');
    await writeFile(join(tmp.path, 'outside.txt'), 'x');
  });

  afterEach(() => tmp.cleanup());

  it('resolves an existing file inside the root, with or without leading slashes', () => {
    const expected = join(root, 'sub', 'inside.txt');
    expect(resolveFileUnderRoot(root, 'sub/inside.txt')).toBe(expected);
    expect(resolveFileUnderRoot(root, '///sub/inside.txt')).toBe(expected);
    expect(resolveFileUnderRoot(root, 'sub/../sub/inside.txt')).toBe(expected);
  });

  it('rejects traversal out of the root even when the target exists', () => {
    expect(resolveFileUnderRoot(root, '../outside.txt')).toBeUndefined();
    expect(resolveFileUnderRoot(root, 'sub/../../outside.txt')).toBeUndefined();
  });

  it('rejects the root itself and anything absent', () => {
    expect(resolveFileUnderRoot(root, '')).toBeUndefined();
    expect(resolveFileUnderRoot(root, '.')).toBeUndefined();
    expect(resolveFileUnderRoot(root, 'sub/missing.txt')).toBeUndefined();
  });

  it('does not treat a sibling root sharing a name prefix as contained', async () => {
    await mkdir(`${root}-evil`, { recursive: true });
    await writeFile(join(`${root}-evil`, 'x.txt'), 'x');
    expect(resolveFileUnderRoot(root, '../root-evil/x.txt')).toBeUndefined();
  });
});
