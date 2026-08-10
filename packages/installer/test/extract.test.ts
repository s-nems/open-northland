import { memoryVfs } from '@open-northland/vfs/memory';
import { describe, expect, it } from 'vitest';
import { extractModEntries, modLayoutOf, zipMemberRelPath } from '../src/mod-install/extract.js';
import { readZipEntries, vfsZipSource, type ZipEntry } from '../src/mod-install/zip.js';
import { buildZip, type FixtureEntry } from './support/zip-fixture.js';

const named = (...names: readonly string[]): ZipEntry[] =>
  names.map((name) => ({ name, method: 0, compressedSize: 0, size: 0, localHeaderOffset: 0 }));

describe('zipMemberRelPath', () => {
  it('keeps normal member paths and rejects escapes', () => {
    expect(zipMemberRelPath('CnMod 1.3.1/DataCnmd/types/houses.ini')).toBe(
      'CnMod 1.3.1/DataCnmd/types/houses.ini',
    );
    expect(zipMemberRelPath('../evil')).toBeUndefined();
    expect(zipMemberRelPath('/abs')).toBeUndefined();
    expect(zipMemberRelPath('C:evil')).toBeUndefined(); // Windows drive-relative, not caught by isAbsolute
    expect(zipMemberRelPath('')).toBeUndefined();
  });
});

describe('modLayoutOf', () => {
  it('takes the wrapping folder as the install name', () => {
    expect(modLayoutOf(named('CnMod 1.3.1/DataCnmd/types/houses.ini'))).toEqual({
      prefix: 'CnMod 1.3.1',
      name: 'CnMod 1.3.1',
    });
  });

  it('names an unwrapped archive itself', () => {
    expect(modLayoutOf(named('DataCnmd/types/houses.ini'))).toEqual({ prefix: '', name: 'CnMod' });
  });

  it('matches the mod folder as a whole segment, spelled exactly', () => {
    expect(modLayoutOf(named('NotDataCnmd/types/houses.ini'))).toBeUndefined();
    // A differently-cased folder would install under its own spelling and then be invisible to the
    // discovery stat on a case-sensitive file system, so it is not a mod root here either.
    expect(modLayoutOf(named('CnMod 1.3.1/datacnmd/types/houses.ini'))).toBeUndefined();
  });

  it('reads members stored with backslashes or a leading ./ like any other', () => {
    expect(modLayoutOf(named('CnMod 1.3.1\\DataCnmd\\types\\houses.ini'))).toEqual({
      prefix: 'CnMod 1.3.1',
      name: 'CnMod 1.3.1',
    });
    expect(modLayoutOf(named('./DataCnmd/types/houses.ini'))).toEqual({ prefix: '', name: 'CnMod' });
  });

  it('prefers the shallowest root when an archive nests several', () => {
    expect(modLayoutOf(named('deep/inner/DataCnmd/a.ini', 'CnMod 1.0/DataCnmd/a.ini'))?.prefix).toBe(
      'CnMod 1.0',
    );
  });

  it('rejects a prefix that would escape the install directory', () => {
    expect(modLayoutOf(named('../evil/DataCnmd/a.ini'))).toBeUndefined();
  });

  it('is undefined when the archive carries no mod', () => {
    expect(modLayoutOf(named('readme.txt'))).toBeUndefined();
  });
});

describe('extractModEntries', () => {
  const extract = async (
    fixture: readonly FixtureEntry[],
  ): Promise<{ fs: ReturnType<typeof memoryVfs>; written: number }> => {
    const fs = memoryVfs();
    await fs.writeFile('archive.zip', buildZip(fixture));
    const source = await vfsZipSource(fs, 'archive.zip');
    const all = await readZipEntries(source);
    const layout = modLayoutOf(all);
    if (layout === undefined) throw new Error('fixture carries no mod root');
    const entries = all.filter((entry) => !entry.name.endsWith('/'));
    const written = await extractModEntries(fs, { source, entries, layout, destDir: 'out' }, () => {});
    return { fs, written };
  };

  it('strips the wrapping prefix and leaves members outside the mod root behind', async () => {
    const data = new TextEncoder().encode('x');
    const { fs, written } = await extract([
      { name: 'CnMod 1.0/DataCnmd/types/houses.ini', data },
      { name: 'CnMod 1.0/readme.txt', data },
      { name: 'unrelated/other.txt', data },
    ]);
    expect(written).toBe(2);
    expect((await fs.stat('out/DataCnmd/types/houses.ini'))?.kind).toBe('file');
    expect((await fs.stat('out/readme.txt'))?.kind).toBe('file');
    expect(await fs.stat('out/unrelated')).toBeUndefined();
  });
});
