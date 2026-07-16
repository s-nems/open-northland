import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readZipEntries, readZipEntryData } from '../src/zip.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';
import { buildZip, type FixtureEntry } from './support/zip-fixture.js';

describe('zip reader', () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('zip');
  });
  afterEach(() => tmp.cleanup());

  const writeZip = async (entries: readonly FixtureEntry[]): Promise<{ path: string; size: number }> => {
    const bytes = buildZip(entries);
    const path = join(tmp.path, 'fixture.zip');
    await writeFile(path, bytes);
    return { path, size: bytes.length };
  };

  it('reads stored and deflated members back byte-identical', async () => {
    const stored = Uint8Array.from([1, 2, 3, 4]);
    const compressible = new TextEncoder().encode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const { path, size } = await writeZip([
      { name: 'CnMod 1.3.1/DataCnmd/types/houses.ini', data: stored },
      { name: 'CnMod 1.3.1/Data/logic/goodtypes.ini', data: compressible, deflate: true },
    ]);
    const fh = await open(path, 'r');
    try {
      const [first, second, ...rest] = await readZipEntries(fh, size);
      if (first === undefined || second === undefined) throw new Error('expected two entries');
      expect(rest).toHaveLength(0);
      expect([first.name, second.name]).toEqual([
        'CnMod 1.3.1/DataCnmd/types/houses.ini',
        'CnMod 1.3.1/Data/logic/goodtypes.ini',
      ]);
      expect(Array.from(await readZipEntryData(fh, first))).toEqual(Array.from(stored));
      expect(Array.from(await readZipEntryData(fh, second))).toEqual(Array.from(compressible));
    } finally {
      await fh.close();
    }
  });

  it('rejects a non-zip file', async () => {
    const path = join(tmp.path, 'not-a.zip');
    await writeFile(path, Buffer.from('definitely not a zip archive, long enough to scan'));
    const fh = await open(path, 'r');
    try {
      await expect(readZipEntries(fh, 49)).rejects.toThrow(/end-of-central-directory/);
    } finally {
      await fh.close();
    }
  });

  it('rejects an unsupported compression method', async () => {
    const { path, size } = await writeZip([{ name: 'x', data: Uint8Array.from([1]) }]);
    const fh = await open(path, 'r');
    try {
      const [entry] = await readZipEntries(fh, size);
      if (entry === undefined) throw new Error('expected one entry');
      await expect(readZipEntryData(fh, { ...entry, method: 12 })).rejects.toThrow(/method 12/);
    } finally {
      await fh.close();
    }
  });
});
