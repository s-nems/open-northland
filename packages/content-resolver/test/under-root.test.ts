import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vjoin } from '@open-northland/vfs';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveFileUnderRoot } from '../src/under-root.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';

/** The security boundary between a crafted request path and the rest of the user's disk. */
describe('resolveFileUnderRoot', () => {
  const fs = nodeVfs();
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

  it('resolves an existing file inside the root, with or without leading slashes', async () => {
    const expected = vjoin(root, 'sub/inside.txt');
    expect(await resolveFileUnderRoot(fs, root, 'sub/inside.txt')).toBe(expected);
    expect(await resolveFileUnderRoot(fs, root, '///sub/inside.txt')).toBe(expected);
    expect(await resolveFileUnderRoot(fs, root, 'sub/../sub/inside.txt')).toBe(expected);
  });

  it('rejects traversal out of the root even when the target exists', async () => {
    expect(await resolveFileUnderRoot(fs, root, '../outside.txt')).toBeUndefined();
    expect(await resolveFileUnderRoot(fs, root, 'sub/../../outside.txt')).toBeUndefined();
  });

  it('rejects the root itself and anything absent', async () => {
    expect(await resolveFileUnderRoot(fs, root, '')).toBeUndefined();
    expect(await resolveFileUnderRoot(fs, root, '.')).toBeUndefined();
    expect(await resolveFileUnderRoot(fs, root, 'sub/missing.txt')).toBeUndefined();
  });

  it('does not treat a sibling root sharing a name prefix as contained', async () => {
    await mkdir(`${root}-evil`, { recursive: true });
    await writeFile(join(`${root}-evil`, 'x.txt'), 'x');
    expect(await resolveFileUnderRoot(fs, root, '../root-evil/x.txt')).toBeUndefined();
  });
});
