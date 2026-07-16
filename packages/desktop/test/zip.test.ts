import { open, readFile, writeFile } from 'node:fs/promises';
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

  it('reads stored and deflated members back byte-identical, honouring a local-only extra field', async () => {
    const stored = Uint8Array.from([1, 2, 3, 4]);
    const compressible = new TextEncoder().encode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const { path, size } = await writeZip([
      // Local extra differs from the central record's (real archives do this) — the data offset
      // must come from the local header.
      {
        name: 'CnMod 1.3.1/DataCnmd/types/houses.ini',
        data: stored,
        localExtra: Uint8Array.from([9, 9, 9, 9]),
      },
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
      expect(Array.from(await readZipEntryData(fh, first, size))).toEqual(Array.from(stored));
      expect(Array.from(await readZipEntryData(fh, second, size))).toEqual(Array.from(compressible));
    } finally {
      await fh.close();
    }
  });

  it('caps a lying deflate member at its declared uncompressed size (zip bomb)', async () => {
    const bomb = new Uint8Array(1 << 20); // 1 MiB of zeros compresses to ~1 KB
    const { path, size } = await writeZip([{ name: 'bomb', data: bomb, deflate: true }]);
    const fh = await open(path, 'r');
    try {
      const [entry] = await readZipEntries(fh, size);
      if (entry === undefined) throw new Error('expected one entry');
      // Honest size inflates fine…
      expect((await readZipEntryData(fh, entry, size)).length).toBe(bomb.length);
      // …a lying (smaller) declared size aborts the inflate instead of trusting the stream.
      await expect(readZipEntryData(fh, { ...entry, size: 16 }, size)).rejects.toThrow();
    } finally {
      await fh.close();
    }
  });

  it('rejects central-directory and entry offsets that lie outside the file', async () => {
    const { path, size } = await writeZip([{ name: 'x', data: Uint8Array.from([1]) }]);
    const bytes = await readFile(path);
    // Corrupt the EOCD's central-directory size to reach past end-of-file.
    bytes.writeUInt32LE(0xff00, bytes.length - 22 + 12);
    await writeFile(path, bytes);
    const fh = await open(path, 'r');
    try {
      await expect(readZipEntries(fh, size)).rejects.toThrow(/outside the file/);
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
      await expect(readZipEntryData(fh, { ...entry, method: 12 }, size)).rejects.toThrow(/method 12/);
    } finally {
      await fh.close();
    }
  });
});
