import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { encodeC2m } from '../../formats/test/fixtures/c2m.js';
import { detectArchiveFormat, openArchive, openNsis } from '../src/archives/open.js';
import { convertMapTree } from '../src/convert.js';
import { MapImportError, type MapImportFailure } from '../src/errors.js';
import { DEFAULT_IMPORT_LIMITS } from '../src/limits.js';
import { mapDat, plaintextMap, under } from './support/maps.js';
import { encodeNsis2, type NsisSetupFile } from './support/nsis.js';
import { encodeTar } from './support/tar.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

async function failure(promise: Promise<unknown>): Promise<MapImportFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof MapImportError) return err.kind;
    throw err;
  }
  throw new Error('expected a MapImportError');
}

const setup = (name: string): NsisSetupFile[] => [
  { path: `data\\maps\\${name}\\map.dat`, bytes: mapDat() },
  { path: `data\\maps\\${name}\\misc.inc`, bytes: bytes(4, 5) },
  { path: `data\\maps\\${name}\\Text\\Ger\\strings.ini`, bytes: bytes(6) },
  { path: 'data\\GameSourceIncludes\\logicdefines.inc', bytes: bytes(7) },
  { path: '$PLUGINSDIR\\modern.dll', bytes: bytes(8) },
];

describe('detectArchiveFormat', () => {
  it('names an NSIS setup installer by its first header', () => {
    const exe = encodeNsis2([{ path: 'map.dat', bytes: mapDat() }]);
    expect(detectArchiveFormat(exe)).toBe('nsis');
    expect(detectArchiveFormat(exe.subarray(0, 511))).toBeUndefined();
    expect(detectArchiveFormat(bytes(1, 2, 3))).toBeUndefined();
  });
});

describe('openNsis', () => {
  it('unpacks a setup installer rooted at its install directory, map files only', async () => {
    const tree = await openNsis(encodeNsis2(setup('vvv')));
    expect([...tree.files.keys()].sort()).toEqual([
      'data/maps/vvv/map.dat',
      'data/maps/vvv/misc.inc',
      'data/maps/vvv/text/ger/strings.ini',
    ]);
    expect(tree.names.get('data/maps/vvv/text/ger/strings.ini')).toBe('data/maps/vvv/Text/Ger/strings.ini');
    expect([...(tree.files.get('data/maps/vvv/misc.inc') ?? [])]).toEqual([4, 5]);
  });

  it('tracks staged output directories through $OUTDIR and cached $_OUTDIR', async () => {
    const tree = await openNsis(
      encodeNsis2([
        { path: 'maps\\map.dat', bytes: bytes(1) },
        { path: 'maps\\text\\ger\\strings.ini', bytes: bytes(2) },
        { path: 'maps\\text\\ger\\briefings\\0500.hlt', bytes: bytes(3) },
        { path: 'other\\map.cif', bytes: bytes(4) },
      ]),
    );
    expect([...tree.files.keys()].sort()).toEqual([
      'maps/map.dat',
      'maps/text/ger/briefings/0500.hlt',
      'maps/text/ger/strings.ini',
      'other/map.cif',
    ]);
  });

  it('reads a Unicode NSIS-3 table the same way', async () => {
    const tree = await openNsis(encodeNsis2(setup('vvv'), { unicode: true }));
    expect([...tree.files.keys()].sort()).toEqual([
      'data/maps/vvv/map.dat',
      'data/maps/vvv/misc.inc',
      'data/maps/vvv/text/ger/strings.ini',
    ]);
  });

  it('converts a setup installer into a playable map', async () => {
    const files = Object.entries(under('data\\maps\\vvv', plaintextMap('Veni Vidi Vici'))).map(
      ([path, content]): NsisSetupFile => ({
        path: path.replace(/\//g, '\\'),
        bytes: typeof content === 'string' ? new TextEncoder().encode(content) : content,
      }),
    );
    const conversion = await convertMapTree(await openNsis(encodeNsis2(files)), { provenance: 'user' });
    expect(conversion.skipped).toEqual([]);
    const [map] = conversion.maps;
    expect(map?.id).toBe('vvv');
    expect(map?.script?.players.length).toBe(2);
    expect(map?.script?.missions.length).toBeGreaterThan(0);
    expect(map?.meta.name.pol).toBe('Veni Vidi Vici');
  });

  it('opens a setup installer that ships one editor .c2m one level deeper', async () => {
    const tree = await openNsis(
      encodeNsis2([{ path: 'usermaps\\Sommerurlaub.c2m', bytes: encodeC2m({ 'map.dat': mapDat() }) }]),
    );
    expect([...tree.files.keys()].sort()).toEqual(['usermaps/sommerurlaub/map.dat']);
  });

  it('opens a zip of setup installers, ignoring a plain exe among them', async () => {
    const zip = zipSync({
      'a.exe': encodeNsis2([{ path: 'map.dat', bytes: bytes(1) }]),
      'readme.exe': bytes(0x4d, 0x5a, 1, 2, 3),
      'plain.tar': encodeTar([{ name: 'map.dat', bytes: bytes(2) }]),
    });
    const tree = await openArchive(zip);
    expect([...tree.files.keys()].sort()).toEqual(['a/map.dat', 'plain/map.dat']);
  });

  it('rejects solid, bzip2, lzma and NSISBI shapes as unsupported', async () => {
    const files = [{ path: 'map.dat', bytes: mapDat() }];
    expect(await failure(openNsis(encodeNsis2(files, { headerMethod: 'solid' })))).toBe(
      'unsupported-archive',
    );
    expect(await failure(openNsis(encodeNsis2(files, { headerMethod: 'bzip2' })))).toBe(
      'unsupported-archive',
    );
    expect(await failure(openNsis(encodeNsis2(files, { headerMethod: 'lzma' })))).toBe('unsupported-archive');
    expect(await failure(openNsis(encodeNsis2(files, { forkFlags: true })))).toBe('unsupported-archive');
  });

  it('rejects a truncated file block as unsupported', async () => {
    const exe = encodeNsis2([{ path: 'map.dat', bytes: mapDat() }]);
    expect(await failure(openNsis(exe.subarray(0, exe.length - 8)))).toBe('unsupported-archive');
  });

  it('opens an uninstaller or a fileless installer to an import without maps', async () => {
    const uninstaller = encodeNsis2([{ path: 'data\\maps\\x\\map.dat', bytes: mapDat() }], {
      uninstaller: true,
    });
    expect((await openNsis(uninstaller)).files.size).toBe(1);
    expect((await openNsis(encodeNsis2([]))).files.size).toBe(0);
  });

  it('enforces the per-entry and unpacked budgets as too-large', async () => {
    const exe = encodeNsis2([
      { path: 'map.dat', bytes: new Uint8Array(600) },
      { path: 'misc.inc', bytes: new Uint8Array(600) },
    ]);
    const limited = (limits: Partial<typeof DEFAULT_IMPORT_LIMITS>) =>
      failure(openNsis(exe, { limits: { ...DEFAULT_IMPORT_LIMITS, ...limits } }));
    expect(await limited({ entryBytes: 100 })).toBe('too-large');
    expect(await limited({ unpackedBytes: 100 })).toBe('too-large');
    expect(await limited({ entries: 1 })).toBe('too-large');
  });
});
