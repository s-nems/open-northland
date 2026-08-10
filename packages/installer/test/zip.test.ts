import { memoryVfs } from '@open-northland/vfs/memory';
import { describe, expect, it } from 'vitest';
import { readZipEntries, readZipEntryData, vfsZipSource, type ZipSource } from '../src/mod-install/zip.js';
import { buildZip, type FixtureEntry } from './support/zip-fixture.js';

describe('zip reader', () => {
  const ZIP_PATH = 'fixture.zip';

  const sourceOf = async (entries: readonly FixtureEntry[]): Promise<ZipSource> => {
    const fs = memoryVfs();
    await fs.writeFile(ZIP_PATH, buildZip(entries));
    return vfsZipSource(fs, ZIP_PATH);
  };

  it('reads stored and deflated members back byte-identical, honouring a local-only extra field', async () => {
    const stored = Uint8Array.from([1, 2, 3, 4]);
    const compressible = new TextEncoder().encode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const source = await sourceOf([
      // Real archives' local extra field differs from the central record's, so the data offset must
      // come from the local header.
      {
        name: 'CnMod 1.3.1/DataCnmd/types/houses.ini',
        data: stored,
        localExtra: Uint8Array.from([9, 9, 9, 9]),
      },
      { name: 'CnMod 1.3.1/Data/logic/goodtypes.ini', data: compressible, deflate: true },
    ]);
    const [first, second, ...rest] = await readZipEntries(source);
    if (first === undefined || second === undefined) throw new Error('expected two entries');
    expect(rest).toEqual([]);
    expect(first.name).toBe('CnMod 1.3.1/DataCnmd/types/houses.ini');
    expect(Array.from(await readZipEntryData(source, first))).toEqual(Array.from(stored));
    expect(Array.from(await readZipEntryData(source, second))).toEqual(Array.from(compressible));
  });

  it('caps deflate output at the declared uncompressed size', async () => {
    const bomb = new Uint8Array(1 << 16);
    const source = await sourceOf([{ name: 'bomb', data: bomb, deflate: true }]);
    const [entry] = await readZipEntries(source);
    if (entry === undefined) throw new Error('expected one entry');
    expect((await readZipEntryData(source, entry)).length).toBe(bomb.length);
    await expect(readZipEntryData(source, { ...entry, size: 16 })).rejects.toThrow();
  });

  it('rejects central-directory and entry offsets that lie outside the file', async () => {
    const bytes = buildZip([{ name: 'x', data: Uint8Array.from([1]) }]);
    // Corrupt the EOCD's central-directory size to reach past end-of-file.
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      bytes.length - 22 + 12,
      0xff00,
      true,
    );
    const fs = memoryVfs();
    await fs.writeFile(ZIP_PATH, bytes);
    await expect(readZipEntries(await vfsZipSource(fs, ZIP_PATH))).rejects.toThrow(/outside the file/);
  });

  it('rejects a non-zip file', async () => {
    const fs = memoryVfs();
    await fs.writeFile(ZIP_PATH, new TextEncoder().encode('definitely not a zip archive, long enough'));
    await expect(readZipEntries(await vfsZipSource(fs, ZIP_PATH))).rejects.toThrow(
      /end-of-central-directory/,
    );
  });

  it('rejects an unsupported compression method', async () => {
    const source = await sourceOf([{ name: 'x', data: Uint8Array.from([1]) }]);
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
