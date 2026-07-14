import { describe, expect, it } from 'vitest';
import {
  CHUNK_HEADER_SIZE,
  decodeMapDat,
  decodeMapSize,
  encodeMapDat,
  encodeMapSize,
  findChunk,
  HOIX_MARKER,
  TEND_ID,
  tagToId,
  XEND_ID,
} from '../src/decoders/mapdat/index.js';
import { le32 } from './support/bytes.js';

/**
 * `map.dat` container decoder tests. No copyrighted fixtures are committed: we synthesize a
 * `hoix`-chunk file in memory with the faithful `encodeMapDat`, then assert `decodeMapDat` recovers
 * the chunk table. The shape mirrors a real tutorial map.dat inspected during the Phase-2 spike (a
 * `logi`/`lgmm` landscape group → `lsiz`/`lm**` layers → `xend`, then an `emmm` entity group →
 * `xend`, then `tend`).
 */

describe('tagToId / tag round-trip', () => {
  it('reverses the disk byte order (disk "zisl" => tag "lsiz")', () => {
    // "lsiz" tag => disk bytes z,i,s,l (low->high) => 0x6c73697a
    expect(tagToId('lsiz')).toBe(0x6c73697a);
    // The named terminator ids match their tags.
    expect(tagToId('xend')).toBe(XEND_ID);
    expect(tagToId('tend')).toBe(TEND_ID);
  });

  it('decodeMapDat recovers the human-readable tag from the raw id', () => {
    const map = decodeMapDat(
      encodeMapDat([{ tag: 'lsiz', payload: encodeMapSize({ width: 1, height: 1 }) }]),
    );
    expect(map.chunks[0]?.tag).toBe('lsiz');
    expect(map.chunks[0]?.id).toBe(tagToId('lsiz'));
  });
});

describe('decodeMapDat', () => {
  it('round-trips a flat chunk table (tags, versions, depths, payloads)', () => {
    const lmhe = Uint8Array.of(0x70, 0x63, 0x6b); // arbitrary "pck"-ish packed bytes
    const bytes = encodeMapDat([
      { tag: 'logi', version: 0, depth: 0 }, // group bracket, length 0
      { tag: 'lgmm', version: 0, depth: 0 },
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 128, height: 218 }) },
      { tag: 'lmhe', version: 1, payload: lmhe },
      { tag: 'xend', version: 0 },
      { tag: 'emmm', version: 0 },
      { tag: 'xend', version: 0 },
      { tag: 'tend', version: 0 },
    ]);

    const map = decodeMapDat(bytes);
    expect(map.chunks.map((c) => c.tag)).toEqual([
      'logi',
      'lgmm',
      'lsiz',
      'lmhe',
      'xend',
      'emmm',
      'xend',
      'tend',
    ]);
    // Group/terminator chunks carry a zero-length payload.
    expect(map.chunks[0]?.length).toBe(0);
    expect(map.chunks[0]?.payload.length).toBe(0);
    // The raw payload view is recovered exactly.
    expect(map.chunks[3]?.tag).toBe('lmhe');
    expect(map.chunks[3]?.version).toBe(1);
    expect(map.chunks[3]?.payload).toEqual(lmhe);
    // Walked the whole file: no trailing bytes consumed past the last chunk.
    const last = map.chunks[map.chunks.length - 1];
    expect((last?.payloadOffset ?? 0) + (last?.length ?? 0)).toBe(bytes.length);
  });

  it('exposes a zero-copy payload view into the source buffer', () => {
    const payload = Uint8Array.of(9, 8, 7);
    const bytes = encodeMapDat([{ tag: 'lmlt', version: 1, payload }]);
    const map = decodeMapDat(bytes);
    const view = map.chunks[0]?.payload as Uint8Array;
    // Mutating the view mutates the underlying file buffer (it is a subarray, not a copy).
    view[0] = 0xff;
    expect(bytes[CHUNK_HEADER_SIZE]).toBe(0xff);
  });

  it('throws on a non-hoix marker', () => {
    // A header whose marker is wrong (0xDEADBEEF) instead of "hoix".
    const bad = Uint8Array.from([
      ...le32(0xdeadbeef),
      ...le32(tagToId('lsiz')),
      ...le32(1),
      ...le32(0),
      ...le32(0),
      ...le32(0),
      ...le32(0),
      ...le32(0),
    ]);
    expect(() => decodeMapDat(bad)).toThrow(/hoix marker/);
  });

  it('throws on a payload length that overruns the buffer', () => {
    // Claim a 100-byte payload but provide none.
    const bad = Uint8Array.from([
      ...le32(HOIX_MARKER),
      ...le32(tagToId('lmhe')),
      ...le32(1),
      ...le32(100), // length
      ...le32(0),
      ...le32(0),
      ...le32(0),
      ...le32(0),
    ]);
    expect(() => decodeMapDat(bad)).toThrow(/overruns buffer/);
  });

  it('throws on a truncated trailing header', () => {
    const ok = encodeMapDat([{ tag: 'tend' }]);
    const truncated = ok.subarray(0, CHUNK_HEADER_SIZE - 1);
    expect(() => decodeMapDat(truncated)).toThrow(/overruns buffer/);
  });

  it('decodes an empty buffer to no chunks', () => {
    expect(decodeMapDat(new Uint8Array(0)).chunks).toEqual([]);
  });
});

describe('decodeMapSize', () => {
  it('reads lsiz [u32 width][u32 height]', () => {
    const map = decodeMapDat(
      encodeMapDat([{ tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 142, height: 146 }) }]),
    );
    expect(decodeMapSize(map)).toEqual({ width: 142, height: 146 });
  });

  it('throws when lsiz is absent', () => {
    const map = decodeMapDat(encodeMapDat([{ tag: 'lmhe', version: 1, payload: Uint8Array.of(1) }]));
    expect(() => decodeMapSize(map)).toThrow(/no lsiz chunk/);
  });

  it('throws when lsiz payload is not 8 bytes', () => {
    const map = decodeMapDat(encodeMapDat([{ tag: 'lsiz', version: 1, payload: Uint8Array.of(1, 2, 3) }]));
    expect(() => decodeMapSize(map)).toThrow(/expected 8/);
  });
});

describe('findChunk', () => {
  it('returns the first chunk with a tag, or undefined', () => {
    const map = decodeMapDat(
      encodeMapDat([
        { tag: 'lsiz', payload: encodeMapSize({ width: 1, height: 1 }) },
        { tag: 'lmlt', payload: Uint8Array.of(1) },
        { tag: 'lmlt', payload: Uint8Array.of(2) }, // a duplicate tag — first wins
      ]),
    );
    expect(findChunk(map, 'lmlt')?.payload).toEqual(Uint8Array.of(1));
    expect(findChunk(map, 'nope')).toBeUndefined();
  });
});
