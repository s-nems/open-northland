import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryVfs } from '../src/memory.js';
import { nodeVfs } from '../src/node.js';
import { type ReadableVfs, readText, type Vfs, writeText } from '../src/types.js';
import { vjoin } from '../src/vpath.js';

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

it('answers stat with undefined for a path no adapter can address', async () => {
  expect(await memoryVfs().stat('../escape')).toBeUndefined();
});
