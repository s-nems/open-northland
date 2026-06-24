import { describe, expect, it } from 'vitest';
import { decodeLib, encodeLib, filenameChecksum, findLibFile } from '../src/decoders/lib.js';

/**
 * `.lib` archive decoder tests. No copyrighted fixtures are committed: we synthesize an archive
 * in memory with the faithful `encodeLib`, then assert `decodeLib` recovers the directory and
 * payloads. The shape mirrors the real `data0001.lib` inspected during Phase 1 (version 1, groups
 * like `data\`, files keyed by backslash paths).
 */

const bytesOf = (...vals: number[]): Uint8Array => Uint8Array.from(vals);

/** Little-endian u32 as 4 bytes (for hand-building a malformed directory). */
const le32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

describe('filenameChecksum', () => {
  it('is the mod-256 sum of lowercased ASCII byte values', () => {
    // 'ab' -> 0x61 + 0x62 = 0xC3
    expect(filenameChecksum('ab')).toBe(0xc3);
    // case-insensitive: uppercase folds to lowercase before summing
    expect(filenameChecksum('AB')).toBe(filenameChecksum('ab'));
    expect(filenameChecksum('')).toBe(0);
  });

  it('wraps at 256', () => {
    // bytes 0xFF + 0x02 = 0x101 -> 0x01 (neither is an A-Z letter, so no case folding)
    expect(filenameChecksum(String.fromCharCode(0xff, 0x02))).toBe(0x01);
  });
});

describe('decodeLib', () => {
  it('round-trips groups and files (names, values, payloads)', () => {
    const archive = encodeLib({
      version: 1,
      groups: [
        { name: '\\', value: 0 },
        { name: 'data\\', value: 1 },
      ],
      files: [
        { name: 'data\\logic\\goodtypes.cif', data: bytesOf(1, 2, 3, 4) },
        { name: 'data\\engine2d\\palette.pcx', data: bytesOf(0xaa, 0xbb) },
        { name: 'data\\empty.dat', data: new Uint8Array(0) },
      ],
    });

    const lib = decodeLib(archive);
    expect(lib.version).toBe(1);
    expect(lib.groups).toEqual([
      { name: '\\', value: 0 },
      { name: 'data\\', value: 1 },
    ]);

    expect(lib.files.map((f) => f.name)).toEqual([
      'data\\logic\\goodtypes.cif',
      'data\\engine2d\\palette.pcx',
      'data\\empty.dat',
    ]);
    expect(lib.files[0]?.data).toEqual(bytesOf(1, 2, 3, 4));
    expect(lib.files[1]?.data).toEqual(bytesOf(0xaa, 0xbb));
    expect(lib.files[2]?.data).toEqual(new Uint8Array(0));
    // checksum is derived from the name, not stored on disk
    expect(lib.files[0]?.checksum).toBe(filenameChecksum('data\\logic\\goodtypes.cif'));
  });

  it('defaults version to 1 and tolerates an archive with no groups', () => {
    const lib = decodeLib(encodeLib({ files: [{ name: 'a.dat', data: bytesOf(9) }] }));
    expect(lib.version).toBe(1);
    expect(lib.groups).toEqual([]);
    expect(lib.files).toHaveLength(1);
    expect(lib.files[0]?.data).toEqual(bytesOf(9));
  });

  it('decodes an empty archive', () => {
    const lib = decodeLib(encodeLib({ files: [] }));
    expect(lib.groups).toEqual([]);
    expect(lib.files).toEqual([]);
  });

  it('throws a lib-prefixed error on a truncated header (not a raw RangeError)', () => {
    expect(() => decodeLib(new Uint8Array(0))).toThrow(/lib: read of 4 bytes overruns/);
    expect(() => decodeLib(new Uint8Array(10))).toThrow(/lib: read of 4 bytes overruns/);
  });

  it('rejects a payload range that overruns the archive', () => {
    // name "x" (len 1), position=100, size=50 -> [100, 150) overruns this tiny buffer
    const bad = bytesOf(
      ...le32(1), // version
      ...le32(0), // groupCount
      ...le32(1), // fileCount
      ...le32(1), // nameLen
      0x78, // 'x'
      ...le32(100), // position
      ...le32(50), // size
    );
    expect(() => decodeLib(bad)).toThrow(/payload \[100, 150\) overruns archive/);
  });
});

describe('findLibFile', () => {
  const lib = decodeLib(
    encodeLib({
      files: [
        { name: 'data\\logic\\goodtypes.cif', data: bytesOf(1) },
        { name: 'data\\logic\\jobtypes.cif', data: bytesOf(2) },
      ],
    }),
  );

  it('finds by exact name', () => {
    expect(findLibFile(lib, 'data\\logic\\jobtypes.cif')?.data).toEqual(bytesOf(2));
  });

  it('is case-insensitive (mirroring the original lookup)', () => {
    expect(findLibFile(lib, 'DATA\\LOGIC\\GOODTYPES.CIF')?.data).toEqual(bytesOf(1));
  });

  it('returns undefined for a missing name', () => {
    expect(findLibFile(lib, 'data\\logic\\nope.cif')).toBeUndefined();
  });
});
