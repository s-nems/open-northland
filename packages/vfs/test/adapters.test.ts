import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryVfs } from '../src/memory.js';
import { mountVfs } from '../src/mount.js';
import { nodeVfs } from '../src/node.js';
import { readText, type Vfs, writeText } from '../src/types.js';
import { vjoin } from '../src/vpath.js';

/** The shared adapter contract, run against a root prepared by each adapter's harness. */
function adapterContract(makeFs: () => Promise<{ fs: Vfs; root: string }>): void {
  it('round-trips files, creating parents', async () => {
    const { fs, root } = await makeFs();
    const path = vjoin(root, 'a/b/file.bin');
    await fs.writeFile(path, Uint8Array.from([1, 2, 3, 4]));
    expect([...(await fs.readFile(path))]).toEqual([1, 2, 3, 4]);
    expect([...(await fs.readFileSlice(path, 1, 2))]).toEqual([2, 3]);
    expect(await fs.stat(path)).toEqual({ kind: 'file', size: 4 });
    expect(await fs.stat(vjoin(root, 'a/b'))).toEqual({ kind: 'dir', size: 0 });
    expect(await fs.stat(vjoin(root, 'missing'))).toBeUndefined();
  });

  it('lists directories with entry kinds', async () => {
    const { fs, root } = await makeFs();
    await fs.writeFile(vjoin(root, 'd/one.txt'), Uint8Array.of(1));
    await fs.mkdir(vjoin(root, 'd/sub'));
    const entries = (await fs.readdir(vjoin(root, 'd'))).sort((a, b) => a.name.localeCompare(b.name));
    expect(entries).toEqual([
      { name: 'one.txt', kind: 'file' },
      { name: 'sub', kind: 'dir' },
    ]);
    await expect(fs.readdir(vjoin(root, 'nope'))).rejects.toThrow();
  });

  it('removes recursively and tolerates absence', async () => {
    const { fs, root } = await makeFs();
    await fs.writeFile(vjoin(root, 'tree/deep/file'), Uint8Array.of(1));
    await fs.rm(vjoin(root, 'tree'));
    expect(await fs.stat(vjoin(root, 'tree'))).toBeUndefined();
    await fs.rm(vjoin(root, 'tree'));
  });

  it('renames files and directory trees', async () => {
    const { fs, root } = await makeFs();
    await writeText(fs, vjoin(root, 'stage/x/data.txt'), 'payload');
    await fs.rename(vjoin(root, 'stage'), vjoin(root, 'final'));
    expect(await readText(fs, vjoin(root, 'final/x/data.txt'))).toBe('payload');
    expect(await fs.stat(vjoin(root, 'stage'))).toBeUndefined();
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
});

describe('mountVfs', () => {
  adapterContract(() =>
    Promise.resolve({ fs: mountVfs({ '/data': memoryVfs(), '/game': memoryVfs() }), root: '/data' }),
  );

  it('routes by first segment and refuses cross-mount renames', async () => {
    const game = memoryVfs();
    const data = memoryVfs();
    const fs = mountVfs({ '/game': game, '/data': data });
    await fs.writeFile('/data/out.txt', Uint8Array.of(7));
    expect(await data.stat('out.txt')).toEqual({ kind: 'file', size: 1 });
    expect(await fs.stat('/game/out.txt')).toBeUndefined();
    await expect(fs.readFile('/elsewhere/x')).rejects.toThrow(/outside every mount/);
    await expect(fs.rename('/data/out.txt', '/game/out.txt')).rejects.toThrow(/across mounts/);
  });
});
