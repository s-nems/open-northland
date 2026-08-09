import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readZipEntries, readZipEntryData, vfsZipSource, type ZipSource } from '../src/mod-install/zip.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';
import { buildZip, type FixtureEntry } from './support/zip-fixture.js';

describe('zip reader', () => {
  const fs = nodeVfs();
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('zip');
  });
  afterEach(() => tmp.cleanup());

  const writeZip = async (entries: readonly FixtureEntry[]): Promise<string> => {
    const bytes = buildZip(entries);
    const path = join(tmp.path, 'fixture.zip');
    await writeFile(path, bytes);
    return path;
  };

  it('reads stored and deflated members back byte-identical, honouring a local-only extra field', async () => {
    const stored = Uint8Array.from([1, 2, 3, 4]);
    const compressible = new TextEncoder().encode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const path = await writeZip([
      // Real archives' local extra field differs from the central record's, so the data offset must
      // come from the local header.
      {
        name: 'CnMod 1.3.1/DataCnmd/types/houses.ini',
        data: stored,
        localExtra: Uint8Array.from([9, 9, 9, 9]),
      },
      { name: 'CnMod 1.3.1/Data/logic/goodtypes.ini', data: compressible, deflate: true },
    ]);
    const source = await vfsZipSource(fs, path);
    const [first, second, ...rest] = await readZipEntries(source);
    if (first === undefined || second === undefined) throw new Error('expected two entries');
    expect(rest).toEqual([]);
    expect(first.name).toBe('CnMod 1.3.1/DataCnmd/types/houses.ini');
    expect(Array.from(await readZipEntryData(source, first))).toEqual(Array.from(stored));
    expect(Array.from(await readZipEntryData(source, second))).toEqual(Array.from(compressible));
  });

  it('caps deflate output at the declared uncompressed size', async () => {
    const bomb = new Uint8Array(1 << 16);
    const path = await writeZip([{ name: 'bomb', data: bomb, deflate: true }]);
    const source = await vfsZipSource(fs, path);
    const [entry] = await readZipEntries(source);
    if (entry === undefined) throw new Error('expected one entry');
    expect((await readZipEntryData(source, entry)).length).toBe(bomb.length);
    await expect(readZipEntryData(source, { ...entry, size: 16 })).rejects.toThrow();
  });

  it('rejects central-directory and entry offsets that lie outside the file', async () => {
    const path = await writeZip([{ name: 'x', data: Uint8Array.from([1]) }]);
    const bytes = await readFile(path);
    // Corrupt the EOCD's central-directory size to reach past end-of-file.
    bytes.writeUInt32LE(0xff00, bytes.length - 22 + 12);
    await writeFile(path, bytes);
    const source = await vfsZipSource(fs, path);
    await expect(readZipEntries(source)).rejects.toThrow(/outside the file/);
  });

  it('rejects a non-zip file', async () => {
    const path = join(tmp.path, 'not-a.zip');
    await writeFile(path, Buffer.from('definitely not a zip archive, long enough to scan'));
    const source = await vfsZipSource(fs, path);
    await expect(readZipEntries(source)).rejects.toThrow(/end-of-central-directory/);
  });

  it('rejects an unsupported compression method', async () => {
    const path = await writeZip([{ name: 'x', data: Uint8Array.from([1]) }]);
    const source = await vfsZipSource(fs, path);
    const [entry] = await readZipEntries(source);
    if (entry === undefined) throw new Error('expected one entry');
    await expect(readZipEntryData(source, { ...entry, method: 12 })).rejects.toThrow(/method 12/);
  });

  it('reads through any random-access source, not only files', async () => {
    const bytes = buildZip([{ name: 'x', data: Uint8Array.from([7, 8]) }]);
    const source: ZipSource = {
      size: bytes.length,
      read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
    };
    const [entry] = await readZipEntries(source);
    if (entry === undefined) throw new Error('expected one entry');
    expect(Array.from(await readZipEntryData(source, entry))).toEqual([7, 8]);
  });
});
