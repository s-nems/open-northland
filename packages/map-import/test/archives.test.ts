import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { encodeC2m } from '../../formats/test/fixtures/c2m.js';
import { detectArchiveFormat, openArchive, openC2m, openRar, openZip } from '../src/archives/open.js';
import { MapImportError, type MapImportFailure } from '../src/errors.js';
import { DEFAULT_IMPORT_LIMITS } from '../src/limits.js';
import { treeFromFolder } from '../src/tree.js';
import { encodeRar4 } from './support/rar.js';
import { encodeTar } from './support/tar.js';
import { unrarWasm } from './support/unrar.js';
import { deflated, encodeZip } from './support/zip.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const MAP_DAT = bytes(1, 2, 3);
const MISC = bytes(4, 5);
const MIB = 1024 * 1024;
/** Each crafted entry fits the default per-entry limit; enough of them overrun the unpacked budget 4x. */
const BOMB_ENTRY_BYTES = 15 * MIB;
const BOMB_ENTRIES = 40;
/** Allocation a test tolerates beyond the budget: the one entry that crosses it plus bookkeeping. */
const ALLOCATION_SLACK = 16 * MIB;

/**
 * The failure of one open, and how far ArrayBuffer memory grew across it. Measured on the first open of
 * an archive, so no earlier open's garbage sits in the baseline. A collection during the open can only
 * shrink the reading, never inflate it.
 */
async function failureWithGrowth(
  open: () => Promise<unknown>,
): Promise<{ kind: MapImportFailure; growth: number }> {
  const before = process.memoryUsage().arrayBuffers;
  const kind = await failure(open());
  return { kind, growth: process.memoryUsage().arrayBuffers - before };
}

async function failure(promise: Promise<unknown>): Promise<MapImportFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof MapImportError) return err.kind;
    throw err;
  }
  throw new Error('expected a MapImportError');
}

/** Sets general-purpose flag bit 0 (encrypted) on every local and central header of a zip. */
function markZipEncrypted(zip: Uint8Array): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let at = 0; at + 4 <= out.length; at++) {
    const signature = view.getUint32(at, true);
    if (signature === 0x04034b50) view.setUint16(at + 6, view.getUint16(at + 6, true) | 1, true);
    if (signature === 0x02014b50) view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true);
  }
  return out;
}

describe('openZip', () => {
  it('keeps only map files, keyed lower-case with their spelling kept', async () => {
    const zip = zipSync({
      'Pack/Main/MAP.DAT': MAP_DAT,
      'Pack/Main/misc.inc': MISC,
      'Pack/Main/Text/Pol/strings.ini': bytes(6),
      'Pack/readme.txt': bytes(7),
      'Pack/Main/text/pol/briefings/Palettes/font.pcx': bytes(8),
    });
    const tree = await openZip(zip);
    expect([...tree.files.keys()].sort()).toEqual([
      'pack/main/map.dat',
      'pack/main/misc.inc',
      'pack/main/text/pol/strings.ini',
    ]);
    expect(tree.names.get('pack/main/map.dat')).toBe('Pack/Main/MAP.DAT');
    expect(Array.from(tree.files.get('pack/main/map.dat') ?? [])).toEqual([1, 2, 3]);
  });

  it('opens a nested .c2m one level deep under its own path without the extension', async () => {
    const c2m = encodeC2m({ 'map.dat': MAP_DAT, 'text/pol/strings.cif': bytes(9) });
    const tree = await openZip(zipSync({ 'TGC_Polski.c2m': c2m, 'notes.txt': bytes(1) }));
    expect([...tree.files.keys()].sort()).toEqual(['tgc_polski/map.dat', 'tgc_polski/text/pol/strings.cif']);
  });

  it('opens a nested archive by its leading bytes when the extension lies', async () => {
    const tree = await openZip(zipSync({ 'Pack.rar': zipSync({ 'Map/map.dat': MAP_DAT }) }));
    expect([...tree.files.keys()]).toEqual(['pack/map/map.dat']);
  });

  it('ignores an archive nested two levels deep', async () => {
    const inner = zipSync({ 'Deep/map.dat': MAP_DAT });
    const middle = zipSync({ 'inner.zip': inner, 'Mid/map.dat': MAP_DAT });
    const tree = await openZip(zipSync({ 'middle.zip': middle }));
    expect([...tree.files.keys()]).toEqual(['middle/mid/map.dat']);
  });

  it('fails a truncated archive, an encrypted map entry and a traversing path as unsupported', async () => {
    const zip = zipSync({ 'Map/map.dat': MAP_DAT });
    expect(await failure(openZip(zip.subarray(0, zip.length - 10)))).toBe('unsupported-archive');
    expect(await failure(openZip(markZipEncrypted(zip)))).toBe('unsupported-archive');
    expect(await failure(openZip(zipSync({ '../map.dat': MAP_DAT })))).toBe('unsupported-archive');
    expect(await failure(openZip(zipSync({ 'C:/Map/map.dat': MAP_DAT })))).toBe('unsupported-archive');
  });

  it('fails two entries that fold onto one path', async () => {
    expect(await failure(openZip(zipSync({ 'Map/map.dat': MAP_DAT, 'MAP/Map.dat': MAP_DAT })))).toBe(
      'unsupported-archive',
    );
  });

  it('enforces every caller-supplied limit as too-large', async () => {
    const zip = zipSync({ 'Map/map.dat': new Uint8Array(100), 'Map/misc.inc': MISC, 'a.txt': bytes(1) });
    const limited = (limits: Partial<typeof DEFAULT_IMPORT_LIMITS>) =>
      failure(openZip(zip, { limits: { ...DEFAULT_IMPORT_LIMITS, ...limits } }));
    expect(await limited({ archiveBytes: zip.length - 1 })).toBe('too-large');
    expect(await limited({ entryBytes: 99 })).toBe('too-large');
    expect(await limited({ unpackedBytes: 101 })).toBe('too-large');
    expect(await limited({ entries: 2 })).toBe('too-large');
    expect(await limited({ depth: 1 })).toBe('too-large');
    expect((await openZip(zip, { limits: { ...DEFAULT_IMPORT_LIMITS, entries: 3 } })).files.size).toBe(2);
  });
});

describe('unpacked budget', () => {
  const zeros = deflated(new Uint8Array(BOMB_ENTRY_BYTES));
  const tiny = deflated(MAP_DAT);
  const bomb = (content: typeof zeros, declaredSize?: number) =>
    encodeZip(
      Array.from({ length: BOMB_ENTRIES }, (_, i) => ({
        path: `m${i}/map.dat`,
        content,
        ...(declaredSize === undefined ? {} : { declaredSize }),
      })),
    );

  it('fails a zip of 40 x 15 MiB zero entries before inflating past the budget', async () => {
    const zip = bomb(zeros);
    expect(zip.length).toBeLessThan(MIB);
    const { kind, growth } = await failureWithGrowth(() => openZip(zip));
    expect(kind).toBe('too-large');
    expect(growth).toBeLessThan(DEFAULT_IMPORT_LIMITS.unpackedBytes + ALLOCATION_SLACK);
  });

  it('fails entries that declare 15 MiB but hold 3 bytes on the declared total, before inflating', async () => {
    const zip = bomb(tiny, BOMB_ENTRY_BYTES);
    const { kind, growth } = await failureWithGrowth(() => openZip(zip));
    expect(kind).toBe('too-large');
    expect(growth).toBeLessThan(DEFAULT_IMPORT_LIMITS.unpackedBytes + ALLOCATION_SLACK);
  });

  it('fails one entry whose inflated size differs from its declared size as unsupported', async () => {
    const lying = encodeZip([{ path: 'Map/map.dat', content: tiny, declaredSize: BOMB_ENTRY_BYTES }]);
    expect(await failure(openZip(lying))).toBe('unsupported-archive');
    const honest = await openZip(encodeZip([{ path: 'Map/map.dat', content: tiny }]));
    expect(Array.from(honest.files.get('map/map.dat') ?? [])).toEqual([1, 2, 3]);
  });

  it('fails a ZIP64 archive as unsupported, so an encrypted entry cannot slip past the directory scan', async () => {
    const entry = { path: 'Map/map.dat', content: tiny };
    expect(await failure(openZip(encodeZip([{ ...entry, encrypted: true }], { zip64: true })))).toBe(
      'unsupported-archive',
    );
    expect(await failure(openZip(encodeZip([entry], { zip64: true })))).toBe('unsupported-archive');
  });

  it('reserves RAR entries from the header list before extracting, and refuses a lying header', async () => {
    const entries = Array.from({ length: BOMB_ENTRIES }, (_, i) => ({
      path: `m${i}/map.dat`,
      bytes: MAP_DAT,
      declaredSize: BOMB_ENTRY_BYTES,
    }));
    expect(await failure(openRar(encodeRar4(entries), unrarWasm()))).toBe('too-large');
    const lying = encodeRar4([{ path: 'Map/map.dat', bytes: MAP_DAT, declaredSize: MISC.length }]);
    expect(await failure(openRar(lying, unrarWasm()))).toBe('unsupported-archive');
  });

  it('copies a view over a larger buffer, so the tree pins only what it shows', async () => {
    const backing = new Uint8Array(MIB);
    backing.set(MAP_DAT);
    const tree = await treeFromFolder(['Map/map.dat'], async () => backing.subarray(0, MAP_DAT.length));
    const kept = tree.files.get('map/map.dat');
    expect(kept?.buffer.byteLength).toBe(MAP_DAT.length);
    expect(Array.from(kept ?? [])).toEqual([1, 2, 3]);
  });
});

describe('openC2m', () => {
  it('drops the currentusermap export root so the map sits at the tree root', async () => {
    const tree = await openC2m(encodeC2m({ 'map.dat': MAP_DAT, 'text/pol/briefings/font12.fnt': bytes(1) }));
    expect([...tree.files.keys()]).toEqual(['map.dat']);
  });

  it('pads the tail a cut-off file still promises', async () => {
    const c2m = encodeC2m({ 'map.dat': MAP_DAT });
    const tree = await openC2m(c2m.subarray(0, c2m.length - 1));
    expect([...tree.files.keys()]).toEqual(['map.dat']);
    expect(tree.files.get('map.dat')?.length).toBe(MAP_DAT.length);
  });

  it('still fails a c2m whose directory is damaged as unsupported', async () => {
    const c2m = encodeC2m({ 'map.dat': MAP_DAT });
    const broken = c2m.slice();
    broken[0] = 9;
    expect(await failure(openC2m(broken))).toBe('unsupported-archive');
  });
});

describe('openRar', () => {
  it('keeps the map files of a plain RAR4 archive', async () => {
    const rar = encodeRar4([
      { path: 'Mapa/map.dat', bytes: MAP_DAT },
      { path: 'Mapa/misc.inc', bytes: MISC },
      { path: 'Mapa/readme.txt', bytes: bytes(1) },
    ]);
    const tree = await openRar(rar, unrarWasm());
    expect([...tree.files.keys()].sort()).toEqual(['mapa/map.dat', 'mapa/misc.inc']);
    expect(Array.from(tree.files.get('mapa/misc.inc') ?? [])).toEqual([4, 5]);
  });

  it('fails a passworded map entry as unsupported, but ignores a passworded stray file', async () => {
    const locked = encodeRar4([{ path: 'Mapa/map.dat', bytes: MAP_DAT, passworded: true }]);
    expect(await failure(openRar(locked, unrarWasm()))).toBe('unsupported-archive');
    const strayLocked = encodeRar4([
      { path: 'Mapa/map.dat', bytes: MAP_DAT },
      { path: 'Mapa/secret.txt', bytes: bytes(1), passworded: true },
    ]);
    expect([...(await openRar(strayLocked, unrarWasm())).files.keys()]).toEqual(['mapa/map.dat']);
  });

  it('opens a RAR nested in a zip when the wasm is given, and fails it without', async () => {
    const zip = zipSync({ 'KingDE.rar': encodeRar4([{ path: 'King/map.dat', bytes: MAP_DAT }]) });
    expect([...(await openZip(zip, { unrarWasm: unrarWasm() })).files.keys()]).toEqual([
      'kingde/king/map.dat',
    ]);
    expect(await failure(openZip(zip))).toBe('unsupported-archive');
  });
});

describe('tar archives', () => {
  const text = (value: string): Uint8Array => new TextEncoder().encode(value);
  /** Longer than one 512-byte block, so the next header sits past padding. */
  const LONG_INI = text('x'.repeat(600));

  it('keeps the map files of a map folder, skipping directory entries', async () => {
    const tar = encodeTar([
      { name: 'DECISION TIME/', type: '5' },
      { name: 'DECISION TIME/map.dat', bytes: MAP_DAT },
      { name: 'DECISION TIME/map.ini', bytes: LONG_INI },
      { name: 'DECISION TIME/text/pol/briefings/', type: '5' },
      { name: 'DECISION TIME/misc.inc', bytes: MISC, gnu: true },
      { name: 'DECISION TIME/readme.txt', bytes: bytes(1) },
    ]);
    expect(detectArchiveFormat(tar)).toBe('tar');
    const tree = await openArchive(tar);
    expect([...tree.files.keys()].sort()).toEqual([
      'decision time/map.dat',
      'decision time/map.ini',
      'decision time/misc.inc',
    ]);
    expect(Array.from(tree.files.get('decision time/misc.inc') ?? [])).toEqual([4, 5]);
    expect(tree.files.get('decision time/map.ini')?.length).toBe(LONG_INI.length);
  });

  it('joins a POSIX prefix before the name', async () => {
    const tar = encodeTar([{ prefix: 'Pack/Some Long Folder', name: 'Map/map.dat', bytes: MAP_DAT }]);
    expect([...(await openArchive(tar)).files.keys()]).toEqual(['pack/some long folder/map/map.dat']);
  });

  it('skips GNU long-name and pax records with their data', async () => {
    const tar = encodeTar([
      { name: '././@LongLink', type: 'L', bytes: text('Map/misc.inc'), gnu: true },
      { name: 'Map/misc.inc', bytes: MISC, gnu: true },
      { name: 'PaxHeaders/map.dat', type: 'x', bytes: LONG_INI },
      { name: 'Map/map.dat', bytes: MAP_DAT },
    ]);
    expect([...(await openArchive(tar)).files.keys()].sort()).toEqual(['map/map.dat', 'map/misc.inc']);
  });

  it('fails a bad header checksum and a size running past the bytes as unsupported', async () => {
    const skewed = encodeTar([{ name: 'Map/map.dat', bytes: MAP_DAT, checksumSkew: 1 }]);
    expect(await failure(openArchive(skewed))).toBe('unsupported-archive');
    const truncated = encodeTar([{ name: 'Map/map.dat', bytes: MAP_DAT, declaredSize: 8 * MIB }]);
    expect(await failure(openArchive(truncated))).toBe('unsupported-archive');
  });

  it('opens a tar nested in a zip one level deep', async () => {
    const zip = zipSync({ 'decision_time.tar': encodeTar([{ name: 'Map/map.dat', bytes: MAP_DAT }]) });
    expect([...(await openZip(zip)).files.keys()]).toEqual(['decision_time/map/map.dat']);
  });
});

describe('openArchive', () => {
  it('loads optional RAR support only when needed, sharing it across nested archives', async () => {
    const unavailable = vi.fn(async (): Promise<ArrayBuffer> => {
      throw new Error('decoder offline');
    });
    const zip = zipSync({ 'Map/map.dat': MAP_DAT });
    expect([...(await openArchive(zip, { unrarWasm: unavailable })).files.keys()]).toEqual(['map/map.dat']);
    expect(unavailable).not.toHaveBeenCalled();

    const rar = encodeRar4([{ path: 'Map/map.dat', bytes: MAP_DAT }]);
    const nested = zipSync({ 'A.rar': rar, 'B.rar': rar });
    const load = vi.fn(async () => unrarWasm());
    expect([...(await openArchive(nested, { unrarWasm: load })).files.keys()]).toEqual([
      'a/map/map.dat',
      'b/map/map.dat',
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await failure(openArchive(nested, { unrarWasm: unavailable }))).toBe('unsupported-archive');
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('tells the formats apart by their leading bytes', async () => {
    const rar = encodeRar4([{ path: 'R/map.dat', bytes: MAP_DAT }]);
    expect(detectArchiveFormat(zipSync({ 'a/map.dat': MAP_DAT }))).toBe('zip');
    expect(detectArchiveFormat(rar)).toBe('rar');
    expect(detectArchiveFormat(encodeC2m({ 'map.dat': MAP_DAT }))).toBe('c2m');
    expect([...(await openArchive(rar, { unrarWasm: unrarWasm() })).files.keys()]).toEqual(['r/map.dat']);
    expect(await failure(openArchive(bytes(0x1f, 0x8b, 8, 0)))).toBe('unsupported-archive');
  });
});

it('rejects deflate output larger than its declaration before inflating the full bomb', async () => {
  const content = deflated(new Uint8Array(32 * MIB));
  const zip = encodeZip([{ path: 'map.dat', content, declaredSize: 1 }]);
  const { kind, growth } = await failureWithGrowth(() => openZip(zip));
  expect(kind).toBe('unsupported-archive');
  expect(growth).toBeLessThan(4 * MIB);
});

it('rejects C2M entry counts before reading the declared records', async () => {
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(8, DEFAULT_IMPORT_LIMITS.entries + 1, true);
  expect(await failure(openC2m(header))).toBe('too-large');
});

it('reads stored ZIP entries and rejects repeated exact paths', async () => {
  const tree = await openZip(zipSync({ 'map.dat': [MAP_DAT, { level: 0 }] }));
  expect(tree.files.get('map.dat')).toEqual(MAP_DAT);
  const content = deflated(MAP_DAT);
  expect(
    await failure(
      openZip(
        encodeZip([
          { path: 'map.dat', content },
          { path: 'map.dat', content },
        ]),
      ),
    ),
  ).toBe('unsupported-archive');
});

it.each(['padding', 'empty blocks'] as const)('bounds DEFLATE input without output: %s', async (kind) => {
  const compressed = new Uint8Array(256 * 1024);
  if (kind === 'padding') compressed.set([3, 0]);
  else {
    // Non-final empty stored blocks, each aligned and carrying LEN=0, NLEN=65535.
    for (let at = 0; at + 5 <= compressed.length; at += 5) compressed.set([0, 0, 0, 255, 255], at);
  }
  const zip = encodeZip([{ path: 'map.dat', content: { deflated: compressed, crc: 0, size: 0 } }]);
  expect(await failure(openZip(zip))).toBe('too-large');
});

it('accepts a maximum-size stored DEFLATE block before its first output', async () => {
  const compressed = new Uint8Array(5 + 65535);
  compressed.set([1, 255, 255, 0, 0]);
  compressed.fill(65, 5);
  const zip = encodeZip([{ path: 'map.dat', content: { deflated: compressed, crc: 0, size: 65535 } }]);
  expect((await openZip(zip)).files.get('map.dat')).toEqual(new Uint8Array(65535).fill(65));
});

it('rejects central-directory entries that replay overlapping compressed bytes', async () => {
  const content = deflated(MAP_DAT);
  const zip = encodeZip([
    { path: 'a/map.dat', content },
    { path: 'b/map.dat', content },
  ]);
  const view = new DataView(zip.buffer);
  let firstOffset: number | undefined;
  for (let at = 0; at + 46 <= zip.length; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    if (firstOffset === undefined) firstOffset = view.getUint32(at + 42, true);
    else view.setUint32(at + 42, firstOffset, true);
  }
  expect(await failure(openZip(zip))).toBe('unsupported-archive');
});
