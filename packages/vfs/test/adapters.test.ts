import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryVfs } from '../src/memory.js';
import { mountVfs } from '../src/mount.js';
import { nodeVfs } from '../src/node.js';
import { fileMapVfs, opfsVfs } from '../src/opfs.js';
import { type ReadableVfs, readText, type Vfs, writeText } from '../src/types.js';
import { vjoin } from '../src/vpath.js';
import { fakeOpfsRoot } from './support/fake-opfs.js';

interface Harness<T extends ReadableVfs> {
  readonly fs: T;
  readonly root: string;
}

/** What every harness holds before the read contract runs. */
const SEED: Readonly<Record<string, readonly number[]>> = {
  'top.bin': [1, 2, 3, 4],
  'nest/inner.bin': [9],
};

/** The read half of the contract, which the read-only snapshot adapter joins too. */
function readableContract(makeFs: () => Promise<Harness<ReadableVfs>>): void {
  it('reads whole files and byte ranges', async () => {
    const { fs, root } = await makeFs();
    expect([...(await fs.readFile(vjoin(root, 'top.bin')))]).toEqual([1, 2, 3, 4]);
    expect([...(await fs.readFileSlice(vjoin(root, 'top.bin'), 1, 2))]).toEqual([2, 3]);
  });

  it('stats files, directories, and absence', async () => {
    const { fs, root } = await makeFs();
    expect(await fs.stat(vjoin(root, 'top.bin'))).toEqual({ kind: 'file', size: 4 });
    expect(await fs.stat(vjoin(root, 'nest'))).toEqual({ kind: 'dir', size: 0 });
    expect(await fs.stat(vjoin(root, 'missing'))).toBeUndefined();
  });

  it('lists a directory with entry kinds', async () => {
    const { fs, root } = await makeFs();
    const entries = (await fs.readdir(vjoin(root, ''))).sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(entries).toEqual([
      { name: 'nest', kind: 'dir' },
      { name: 'top.bin', kind: 'file' },
    ]);
    expect(await fs.readdir(vjoin(root, 'nest'))).toEqual([{ name: 'inner.bin', kind: 'file' }]);
  });

  it('rejects reads of what is not there', async () => {
    const { fs, root } = await makeFs();
    await expect(fs.readFile(vjoin(root, 'missing'))).rejects.toThrow();
    await expect(fs.readdir(vjoin(root, 'missing'))).rejects.toThrow();
    await expect(fs.readdir(vjoin(root, 'top.bin'))).rejects.toThrow();
  });
}

/** The whole contract for a writable adapter, seeded through its own `writeFile`. */
function adapterContract(makeFs: () => Promise<Harness<Vfs>>): void {
  readableContract(async () => {
    const { fs, root } = await makeFs();
    for (const [rel, bytes] of Object.entries(SEED)) {
      await fs.writeFile(vjoin(root, rel), Uint8Array.from(bytes));
    }
    return { fs, root };
  });

  it('creates missing parents on write', async () => {
    const { fs, root } = await makeFs();
    const path = vjoin(root, 'a/b/file.bin');
    await fs.writeFile(path, Uint8Array.from([1, 2, 3, 4]));
    expect(await fs.stat(path)).toEqual({ kind: 'file', size: 4 });
    expect(await fs.stat(vjoin(root, 'a/b'))).toEqual({ kind: 'dir', size: 0 });
  });

  it('lists a directory made by mkdir', async () => {
    const { fs, root } = await makeFs();
    await fs.writeFile(vjoin(root, 'd/one.txt'), Uint8Array.of(1));
    await fs.mkdir(vjoin(root, 'd/sub'));
    const entries = (await fs.readdir(vjoin(root, 'd'))).sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(entries).toEqual([
      { name: 'one.txt', kind: 'file' },
      { name: 'sub', kind: 'dir' },
    ]);
  });

  it('removes recursively and tolerates absence', async () => {
    const { fs, root } = await makeFs();
    await fs.writeFile(vjoin(root, 'tree/deep/file'), Uint8Array.of(1));
    await fs.rm(vjoin(root, 'tree'));
    expect(await fs.stat(vjoin(root, 'tree'))).toBeUndefined();
    await fs.rm(vjoin(root, 'tree'));
  });

  it('round-trips text', async () => {
    const { fs, root } = await makeFs();
    await writeText(fs, vjoin(root, 'notes/a.txt'), 'payload');
    expect(await readText(fs, vjoin(root, 'notes/a.txt'))).toBe('payload');
  });

  it('overwrites rather than appends', async () => {
    const { fs, root } = await makeFs();
    const path = vjoin(root, 'again.bin');
    await fs.writeFile(path, Uint8Array.from([1, 2, 3]));
    await fs.writeFile(path, Uint8Array.of(9));
    expect([...(await fs.readFile(path))]).toEqual([9]);
  });

  it('refuses to mix a file and a directory at one path', async () => {
    const { fs, root } = await makeFs();
    const file = vjoin(root, 'clash');
    await fs.writeFile(file, Uint8Array.of(1));
    await expect(fs.writeFile(vjoin(root, 'clash/under.bin'), Uint8Array.of(2))).rejects.toThrow();
    await expect(fs.mkdir(file)).rejects.toThrow();

    const dir = vjoin(root, 'holder');
    await fs.mkdir(dir);
    await expect(fs.writeFile(dir, Uint8Array.of(3))).rejects.toThrow();
  });
}

describe('memoryVfs', () => {
  adapterContract(() => Promise.resolve({ fs: memoryVfs(), root: '' }));
});

describe('nodeVfs', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  adapterContract(async () => {
    const root = await mkdtemp(join(tmpdir(), 'vfs-node-'));
    cleanups.push(root);
    return { fs: nodeVfs(), root };
  });

  it('classifies a symlinked entry by its target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vfs-link-'));
    cleanups.push(root);
    const fs = nodeVfs();
    await fs.writeFile(join(root, 'real/Data/x.bin'), Uint8Array.of(1));
    const { symlink } = await import('node:fs/promises');
    await symlink(join(root, 'real/Data'), join(root, 'Data'), 'dir');
    const entries = (await fs.readdir(root)).sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(entries).toEqual([
      { name: 'Data', kind: 'dir' },
      { name: 'real', kind: 'dir' },
    ]);
  });
});

describe('opfsVfs over faked handles', () => {
  adapterContract(() => Promise.resolve({ fs: opfsVfs(fakeOpfsRoot()), root: '' }));

  it('reports the write failure, not the failure to close after it, and drops the empty file', async () => {
    const fs = opfsVfs(fakeOpfsRoot({ quotaAfterWrites: 0 }));
    await expect(fs.writeFile('a/b.bin', Uint8Array.of(1))).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(await fs.stat('a/b.bin')).toBeUndefined();
  });

  it('propagates a refused delete and stays quiet about an absent one', async () => {
    const root = fakeOpfsRoot();
    await opfsVfs(root).rm('never-existed');
    const refusing = {
      ...root,
      removeEntry: () => Promise.reject(new DOMException('locked', 'NoModificationAllowedError')),
    } as unknown as FileSystemDirectoryHandle;
    await expect(opfsVfs(refusing).rm('doomed.bin')).rejects.toThrow(/locked/);
  });
});

describe('fileMapVfs', () => {
  readableContract(() =>
    Promise.resolve({
      fs: fileMapVfs(
        new Map(
          Object.entries(SEED).map(([rel, bytes]) => [
            rel,
            new File([Uint8Array.from(bytes) as unknown as BlobPart], rel),
          ]),
        ),
      ),
      root: '',
    }),
  );

  it('resolves handle-backed entries only when their bytes or size are asked for', async () => {
    let materialized = 0;
    const file = new File([Uint8Array.of(9, 9, 9)], 'late.bin');
    const handle = {
      getFile: (): Promise<File> => {
        materialized++;
        return Promise.resolve(file);
      },
    } as unknown as FileSystemFileHandle;

    const fs = fileMapVfs(new Map([['deep/late.bin', handle]]));
    expect(materialized).toBe(0);
    expect(await fs.readdir('deep')).toEqual([{ name: 'late.bin', kind: 'file' }]);
    expect(await fs.stat('deep')).toEqual({ kind: 'dir', size: 0 });
    expect(materialized).toBe(0);
    expect([...(await fs.readFile('deep/late.bin'))]).toEqual([9, 9, 9]);
    expect(materialized).toBe(1);
  });
});

describe('mountVfs', () => {
  adapterContract(() =>
    Promise.resolve({ fs: mountVfs({ '/data': memoryVfs(), '/game': memoryVfs() }), root: '/data' }),
  );

  it('routes by first segment and refuses writes into a read-only mount', async () => {
    const data = memoryVfs();
    const fs = mountVfs({
      '/game': fileMapVfs(new Map([['the original', new File([Uint8Array.of(1)], 'the original')]])),
      '/data': data,
    });
    await fs.writeFile('/data/out.txt', Uint8Array.of(7));
    expect(await data.stat('out.txt')).toEqual({ kind: 'file', size: 1 });
    expect(await fs.stat('/game/the original')).toEqual({ kind: 'file', size: 1 });
    expect(await fs.stat('/data/the original')).toBeUndefined();
    await expect(fs.readFile('/elsewhere/x')).rejects.toThrow(/outside every mount/);
    await expect(fs.writeFile('/game/the original', Uint8Array.of(2))).rejects.toThrow(/read-only mount/);
    await expect(fs.rm('/game/the original')).rejects.toThrow(/read-only mount/);
  });

  it('collapses a climbing path before choosing a mount', async () => {
    const game = fileMapVfs(new Map([['the original', new File([Uint8Array.of(1)], 'the original')]]));
    const fs = mountVfs({ '/game': game, '/data': memoryVfs() });
    expect([...(await fs.readFile('/data/../game/the original'))]).toEqual([1]);
    await expect(fs.readFile('/game/../escape')).rejects.toThrow(/outside every mount/);
  });
});

it('answers stat with undefined for a path no adapter can address', async () => {
  expect(await memoryVfs().stat('../escape')).toBeUndefined();
  expect(await opfsVfs(fakeOpfsRoot()).stat('../escape')).toBeUndefined();
  expect(await mountVfs({ '/data': memoryVfs() }).stat('/elsewhere/x')).toBeUndefined();
});
