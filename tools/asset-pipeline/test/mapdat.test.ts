import { describe, expect, it } from 'vitest';
import {
  CHUNK_HEADER_SIZE,
  HALF_CELLS_PER_CELL,
  HOIX_MARKER,
  MAP_LAYER_CODEC_X6,
  MAP_LAYER_CODEC_X8,
  MAP_LAYER_HEADER_SIZE,
  MAP_LAYER_SUBFORMAT,
  type MapDatChunk,
  type MapLayer,
  TEND_ID,
  VOID_TYPE_ID,
  XEND_ID,
  decodeMapDat,
  decodeMapSize,
  decodeStringListChunk,
  encodeMapDat,
  encodeMapSize,
  findChunk,
  isPackedLayer,
  lmltToTerrainMap,
  packMapLayer,
  packX6elLayer,
  reduceHalfCellsToCell,
  tagToId,
  unpackMapLayer,
  unpackX6elLayer,
} from '../src/decoders/mapdat.js';

/**
 * `map.dat` container decoder tests. No copyrighted fixtures are committed: we synthesize a
 * `hoix`-chunk file in memory with the faithful `encodeMapDat`, then assert `decodeMapDat` recovers
 * the chunk table. The shape mirrors a real tutorial map.dat inspected during the Phase-2 spike (a
 * `logi`/`lgmm` landscape group → `lsiz`/`lm**` layers → `xend`, then an `emmm` entity group →
 * `xend`, then `tend`).
 */

/** Little-endian u32 as 4 bytes (for hand-building a malformed/raw header). */
const le32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

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

/**
 * Packed grid-layer codec (`pck`/`X8el`). No copyrighted fixtures: we round-trip a synthetic grid
 * through `packMapLayer` → `unpackMapLayer` and assert byte-exact recovery, then check the inner
 * header the packer wrote matches the layout reverse-engineered from real maps (marker "kcp",
 * codec "X8el", sub-format 0x72, the unpacked-length u32).
 */
describe('unpackMapLayer / pck-X8el round-trip', () => {
  /** Wraps a packed layer payload in a one-chunk map so we can decode it like the real reader does. */
  const layerChunk = (cells: Uint8Array) => {
    const map = decodeMapDat(encodeMapDat([{ tag: 'lmhe', version: 1, payload: packMapLayer(cells) }]));
    return map.chunks[0] as ReturnType<typeof decodeMapDat>['chunks'][number];
  };

  it('round-trips a grid mixing long runs and noisy literals', () => {
    // 250 zeros (one run), a noisy literal stretch, then a long run of 200 — exercises both control
    // forms and the 0x7F per-run cap (runs/literals longer than 127 split across controls).
    const cells = new Uint8Array(250 + 64 + 200);
    let p = 250;
    for (let k = 0; k < 64; k++) cells[p++] = (k * 37 + 11) & 0xff; // pseudo-noise (adjacent-distinct-ish)
    cells.fill(7, p, p + 200);
    const layer = unpackMapLayer(layerChunk(cells));
    expect(layer.codec).toBe(MAP_LAYER_CODEC_X8);
    expect(layer.cells).toEqual(cells);
  });

  it('round-trips an empty grid', () => {
    const layer = unpackMapLayer(layerChunk(new Uint8Array(0)));
    expect(layer.cells.length).toBe(0);
  });

  it('round-trips a single-byte grid (the lone-literal progress guard)', () => {
    const layer = unpackMapLayer(layerChunk(Uint8Array.of(0x42)));
    expect(layer.cells).toEqual(Uint8Array.of(0x42));
  });

  it('round-trips every byte value across a run of each (full alphabet)', () => {
    const cells = new Uint8Array(256 * 3);
    for (let v = 0; v < 256; v++) cells.fill(v, v * 3, v * 3 + 3); // 256 runs of 3
    expect(unpackMapLayer(layerChunk(cells)).cells).toEqual(cells);
  });

  it('writes the reverse-engineered inner header (marker, codec, sub-format, unpacked length)', () => {
    const cells = Uint8Array.of(1, 1, 1, 2, 3);
    const packed = packMapLayer(cells);
    expect(packed[0]).toBe(1); // version
    expect(String.fromCharCode(packed[5] as number, packed[6] as number, packed[7] as number)).toBe('kcp');
    expect(
      String.fromCharCode(
        packed[8] as number,
        packed[9] as number,
        packed[10] as number,
        packed[11] as number,
      ),
    ).toBe('X8el');
    expect(packed[12]).toBe(MAP_LAYER_SUBFORMAT);
    const view = new DataView(packed.buffer);
    expect(view.getUint32(0x0d, true)).toBe(cells.length); // unpacked length
    // innerSize (at +0x01 and repeated at +0x11) accounts for every byte after the +0x01 field.
    expect(view.getUint32(0x01, true)).toBe(packed.length - 5);
    expect(view.getUint32(0x11, true)).toBe(packed.length - 5);
  });

  it('isPackedLayer distinguishes a packed layer from a raw chunk', () => {
    const map = decodeMapDat(
      encodeMapDat([
        { tag: 'lmhe', version: 1, payload: packMapLayer(Uint8Array.of(5, 5, 5)) },
        { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 4, height: 4 }) },
      ]),
    );
    expect(isPackedLayer(map.chunks[0] as never)).toBe(true);
    expect(isPackedLayer(map.chunks[1] as never)).toBe(false);
  });

  it('throws on a non-packed chunk', () => {
    const map = decodeMapDat(
      encodeMapDat([{ tag: 'lsiz', payload: encodeMapSize({ width: 2, height: 2 }) }]),
    );
    expect(() => unpackMapLayer(map.chunks[0] as never)).toThrow(/not a pck-packed layer/);
  });

  it('rejects an X6el layer (those go through unpackX6elLayer, not the byte path)', () => {
    // Hand-build a "kcp"/"X6el" header so the X8el-only codec gate fires.
    const payload = new Uint8Array(MAP_LAYER_HEADER_SIZE);
    payload.set([0x6b, 0x63, 0x70], 0x05); // "kcp"
    payload.set([0x58, 0x36, 0x65, 0x6c], 0x08); // "X6el"
    const map = decodeMapDat(encodeMapDat([{ tag: 'empa', version: 1, payload }]));
    expect(() => unpackMapLayer(map.chunks[0] as never)).toThrow(/is not supported/);
  });

  it('throws on a stream that underruns its declared unpacked length', () => {
    // Declare 100 unpacked bytes but give a stream that produces fewer, then ends.
    const payload = new Uint8Array(MAP_LAYER_HEADER_SIZE + 2);
    payload.set([0x6b, 0x63, 0x70], 0x05);
    payload.set([0x58, 0x38, 0x65, 0x6c], 0x08); // "X8el"
    payload[0x0c] = MAP_LAYER_SUBFORMAT;
    new DataView(payload.buffer).setUint32(0x0d, 100, true); // claim 100 unpacked bytes
    payload[MAP_LAYER_HEADER_SIZE] = 1; // a 1-byte literal control
    payload[MAP_LAYER_HEADER_SIZE + 1] = 0xaa; // its single literal byte → only 1 produced, then EOF
    const map = decodeMapDat(encodeMapDat([{ tag: 'lmhe', version: 1, payload }]));
    expect(() => unpackMapLayer(map.chunks[0] as never)).toThrow(/underran/);
  });

  /** Builds an X8el layer payload with a hand-crafted unpacked length + RLE stream. */
  const craftLayer = (unpackedLength: number, stream: number[]) => {
    const payload = new Uint8Array(MAP_LAYER_HEADER_SIZE + stream.length);
    payload.set([0x6b, 0x63, 0x70], 0x05); // "kcp"
    payload.set([0x58, 0x38, 0x65, 0x6c], 0x08); // "X8el"
    payload[0x0c] = MAP_LAYER_SUBFORMAT;
    new DataView(payload.buffer).setUint32(0x0d, unpackedLength, true);
    payload.set(stream, MAP_LAYER_HEADER_SIZE);
    return decodeMapDat(encodeMapDat([{ tag: 'lmhe', version: 1, payload }])).chunks[0] as never;
  };

  it('throws on a run that overflows the declared grid (corrupt stream)', () => {
    // Grid claims 3 bytes; a run control wants 5 copies → overflow.
    expect(() => unpackMapLayer(craftLayer(3, [0x80 | 5, 0xaa]))).toThrow(/run overflows/);
  });

  it('throws on a literal that overflows the declared grid (corrupt stream)', () => {
    // Grid claims 2 bytes; a 4-byte literal control → overflow.
    expect(() => unpackMapLayer(craftLayer(2, [4, 1, 2, 3, 4]))).toThrow(/literal overflows/);
  });

  it('throws on a literal that reads past the truncated stream end', () => {
    // Grid claims 10 bytes; a 9-byte literal control but only 2 literal bytes present.
    expect(() => unpackMapLayer(craftLayer(10, [9, 1, 2]))).toThrow(/reads past the stream end/);
  });

  it('throws on a run control sitting at the very end with no value byte', () => {
    // Grid claims 5 bytes; a run control is the final stream byte (no value follows).
    expect(() => unpackMapLayer(craftLayer(5, [0x80 | 5]))).toThrow(/no value byte/);
  });
});

/**
 * The `X6el` 2-byte-per-cell ownership codec (`empa`/`empb`). Same fixture-free strategy as the X8el
 * tests: round-trip a synthetic u16 grid through `packX6elLayer` → `unpackX6elLayer` and assert
 * byte-exact recovery, plus the inner header layout reverse-engineered from real maps (the container
 * header is identical to X8el; only the codec id "X6el" and the per-element width differ).
 */
describe('unpackX6elLayer / pck-X6el round-trip', () => {
  /** Wraps a packed X6el payload in a one-chunk map so we can decode it like the real reader does. */
  const layerChunk = (cells: Uint16Array) => {
    const map = decodeMapDat(encodeMapDat([{ tag: 'empa', version: 1, payload: packX6elLayer(cells) }]));
    return map.chunks[0] as ReturnType<typeof decodeMapDat>['chunks'][number];
  };

  it('round-trips a grid mixing long u16 runs and noisy literals', () => {
    // 200 zeros (one run), a noisy literal stretch of distinct u16s, then a long run of 0x0341 —
    // exercises both control forms and the 0x7F per-run element cap (split across controls).
    const cells = new Uint16Array(200 + 50 + 150);
    let p = 200;
    for (let k = 0; k < 50; k++) cells[p++] = (k * 277 + 13) & 0xffff; // adjacent-distinct-ish noise
    cells.fill(0x0341, p, p + 150);
    const layer = unpackX6elLayer(layerChunk(cells));
    expect(layer.codec).toBe(MAP_LAYER_CODEC_X6);
    expect(layer.cells).toEqual(cells);
  });

  it('round-trips an empty grid', () => {
    expect(unpackX6elLayer(layerChunk(new Uint16Array(0))).cells.length).toBe(0);
  });

  it('round-trips a single-element grid (the lone-literal progress guard)', () => {
    expect(unpackX6elLayer(layerChunk(Uint16Array.of(0xbeef))).cells).toEqual(Uint16Array.of(0xbeef));
  });

  it('preserves little-endian byte order of the u16 elements', () => {
    // 0x1234 must pack/unpack with low byte 0x34 first; a round-trip pins the byte order.
    const cells = Uint16Array.of(0x1234, 0x00ff, 0xff00, 0x0000, 0xffff);
    expect(unpackX6elLayer(layerChunk(cells)).cells).toEqual(cells);
  });

  it('decodes a hand-built little-endian stream (pins LE independent of host endianness)', () => {
    // A run of two 0x1234 elements then a literal 0x00ff: the stream bytes are LE (34 12 / ff 00).
    // Decoding this raw stream — not a round-trip — proves the reader is LE-explicit, not host-endian.
    const payload = new Uint8Array(MAP_LAYER_HEADER_SIZE + 6);
    payload.set([0x6b, 0x63, 0x70], 0x05); // "kcp"
    payload.set([0x58, 0x36, 0x65, 0x6c], 0x08); // "X6el"
    payload[0x0c] = MAP_LAYER_SUBFORMAT;
    new DataView(payload.buffer).setUint32(0x0d, 6, true); // 3 u16 cells = 6 bytes
    payload.set([0x80 | 2, 0x34, 0x12, 1, 0xff, 0x00], MAP_LAYER_HEADER_SIZE); // run(2)×0x1234, literal(1)×0x00ff
    const chunk = decodeMapDat(encodeMapDat([{ tag: 'empa', version: 1, payload }])).chunks[0] as never;
    expect(Array.from(unpackX6elLayer(chunk).cells)).toEqual([0x1234, 0x1234, 0x00ff]);
  });

  it('writes the X6el inner header (marker, codec, sub-format, unpacked byte length)', () => {
    const cells = Uint16Array.of(1, 1, 1, 2, 3);
    const packed = packX6elLayer(cells);
    expect(packed[0]).toBe(1); // version
    expect(String.fromCharCode(packed[5] as number, packed[6] as number, packed[7] as number)).toBe('kcp');
    expect(
      String.fromCharCode(
        packed[8] as number,
        packed[9] as number,
        packed[10] as number,
        packed[11] as number,
      ),
    ).toBe('X6el');
    expect(packed[12]).toBe(MAP_LAYER_SUBFORMAT);
    const view = new DataView(packed.buffer);
    expect(view.getUint32(0x0d, true)).toBe(cells.length * 2); // unpacked length is BYTES (= cells × 2)
    expect(view.getUint32(0x01, true)).toBe(packed.length - 5);
    expect(view.getUint32(0x11, true)).toBe(packed.length - 5);
  });

  it('rejects a non-X6el codec (an X8el layer goes through unpackMapLayer)', () => {
    const map = decodeMapDat(
      encodeMapDat([{ tag: 'lmhe', version: 1, payload: packMapLayer(Uint8Array.of(1, 2)) }]),
    );
    expect(() => unpackX6elLayer(map.chunks[0] as never)).toThrow(/is not an X6el/);
  });

  it('rejects a non-packed chunk', () => {
    const map = decodeMapDat(
      encodeMapDat([{ tag: 'lsiz', payload: encodeMapSize({ width: 2, height: 2 }) }]),
    );
    expect(() => unpackX6elLayer(map.chunks[0] as never)).toThrow(/not a pck-packed layer/);
  });

  /** Builds an X6el layer payload with a hand-crafted unpacked length + RLE stream. */
  const craftX6el = (unpackedLength: number, stream: number[]) => {
    const payload = new Uint8Array(MAP_LAYER_HEADER_SIZE + stream.length);
    payload.set([0x6b, 0x63, 0x70], 0x05); // "kcp"
    payload.set([0x58, 0x36, 0x65, 0x6c], 0x08); // "X6el"
    payload[0x0c] = MAP_LAYER_SUBFORMAT;
    new DataView(payload.buffer).setUint32(0x0d, unpackedLength, true);
    payload.set(stream, MAP_LAYER_HEADER_SIZE);
    return decodeMapDat(encodeMapDat([{ tag: 'empa', version: 1, payload }])).chunks[0] as never;
  };

  it('throws on an odd unpacked length (not a whole number of u16 cells)', () => {
    expect(() => unpackX6elLayer(craftX6el(3, [1, 0xaa, 0xbb]))).toThrow(/whole number of u16/);
  });

  it('throws on a run that overflows the declared grid', () => {
    // Grid claims 4 bytes (2 cells); a run wants 5 copies → overflow.
    expect(() => unpackX6elLayer(craftX6el(4, [0x80 | 5, 0xaa, 0xbb]))).toThrow(/run overflows/);
  });

  it('throws on a literal that overflows the declared grid', () => {
    // Grid claims 2 bytes (1 cell); a 2-element literal → overflow.
    expect(() => unpackX6elLayer(craftX6el(2, [2, 1, 2, 3, 4]))).toThrow(/literal overflows/);
  });

  it('throws on a literal that reads past the truncated stream end', () => {
    // Grid claims 10 bytes; a 4-element literal control but only 2 literal bytes present.
    expect(() => unpackX6elLayer(craftX6el(10, [4, 1, 2]))).toThrow(/reads past the stream end/);
  });

  it('throws on a run control at the very end with no value element', () => {
    // Grid claims 4 bytes; a run control is the final stream byte (no u16 value follows).
    expect(() => unpackX6elLayer(craftX6el(4, [0x80 | 2]))).toThrow(/no value element/);
  });

  it('throws on a stream that underruns its declared length', () => {
    // Declare 8 bytes but give a 1-element literal that ends the stream early.
    expect(() => unpackX6elLayer(craftX6el(8, [1, 0xaa, 0xbb]))).toThrow(/underran/);
  });
});

describe('reduceHalfCellsToCell', () => {
  it('returns the value of a uniform cell (all four half-cells equal)', () => {
    expect(reduceHalfCellsToCell(7, 7, 7, 7)).toBe(7);
    expect(reduceHalfCellsToCell(0, 0, 0, 0)).toBe(0);
  });

  it('returns the dominant (most-frequent) value', () => {
    expect(reduceHalfCellsToCell(5, 5, 5, 2)).toBe(5); // 3 vs 1
    expect(reduceHalfCellsToCell(2, 5, 5, 5)).toBe(5); // dominant regardless of position
    expect(reduceHalfCellsToCell(9, 3, 3, 9)).toBe(3); // 2 vs 2 -> lower id wins (tie-break)
  });

  it('breaks ties by the lowest value, independent of half-cell order', () => {
    // Four distinct values — each count 1, so the tie-break selects the minimum every time.
    expect(reduceHalfCellsToCell(8, 1, 4, 2)).toBe(1);
    expect(reduceHalfCellsToCell(2, 4, 1, 8)).toBe(1);
    // Two pairs tied at count 2 -> the smaller of the two pair values.
    expect(reduceHalfCellsToCell(6, 6, 1, 1)).toBe(1);
    expect(reduceHalfCellsToCell(1, 6, 1, 6)).toBe(1);
  });
});

describe('lmltToTerrainMap', () => {
  /** Builds a MapLayer from a flat half-cell byte array (row-major 2W × 2H). */
  const layer = (halfCells: number[]): MapLayer => ({
    codec: MAP_LAYER_CODEC_X8,
    cells: Uint8Array.from(halfCells),
  });

  it('collapses each 2×2 half-cell block into one row-major typeId (raw value IS the typeId)', () => {
    // 2×1 grid = a 4×2 half-cell lane. Cell 0's block is columns 0-1 of both rows (uniform raw 3);
    // cell 1's block is columns 2-3 (dominant raw 5 with a stray 2 in the bottom row).
    const map = lmltToTerrainMap(
      layer([
        3,
        3,
        5,
        5, // half-cell row 0
        3,
        3,
        5,
        2, // half-cell row 1
      ]),
      { width: 2, height: 1 },
    );
    expect(map.width).toBe(2);
    expect(map.height).toBe(1);
    expect(map.typeIds).toEqual([3, 5]); // raw values pass through unshifted
    expect(map.typeIds.length).toBe(2 * 1);
  });

  it('gathers each cell block from BOTH lane rows, not four consecutive bytes', () => {
    // 2×1 grid whose lane rows disagree: reading four consecutive bytes would see [1,1,1,1] for
    // cell 0; the correct 2×2 block is columns 0-1 of each row = [1,1,9,9] -> tie -> lowest (1),
    // and cell 1's block [1,1,9,9] likewise. A wrong flat read would give cell 1 = [9,9,9,9] = 9.
    const map = lmltToTerrainMap(
      layer([
        1,
        1,
        1,
        1, // half-cell row 0
        9,
        9,
        9,
        9, // half-cell row 1
      ]),
      { width: 2, height: 1 },
    );
    expect(map.typeIds).toEqual([1, 1]);
  });

  it('maps the empty half-cell marker (raw 0 = no object) onto the void typeId', () => {
    // Raw values are the 1-based IR typeIds directly ([GfxLandscape] LogicType pins this); raw 0
    // means "no landscape object here" and reduces to `void` (typeId 1) so the sim's
    // buildTerrainGraph always resolves the grid against the IR table.
    const map = lmltToTerrainMap(layer([0, 0, 0, 0]), { width: 1, height: 1 });
    expect(map.typeIds).toEqual([VOID_TYPE_ID]);
  });

  it('produces a typeIds grid sized exactly width × height', () => {
    const cells = 3 * 2;
    const halfCells = new Array(cells * HALF_CELLS_PER_CELL).fill(0);
    const map = lmltToTerrainMap(layer(halfCells), { width: 3, height: 2 });
    expect(map.typeIds.length).toBe(cells);
    expect(map.typeIds).toEqual(new Array(cells).fill(VOID_TYPE_ID));
  });

  it('is deterministic — same layer + dims yield byte-identical typeIds', () => {
    // 3×1 grid = a 6×2 half-cell lane.
    const halfCells = [
      1,
      2,
      7,
      7,
      9,
      4, // half-cell row 0
      2,
      1,
      7,
      7,
      4,
      9, // half-cell row 1
    ];
    const a = lmltToTerrainMap(layer(halfCells), { width: 3, height: 1 });
    const b = lmltToTerrainMap(layer(halfCells), { width: 3, height: 1 });
    expect(a.typeIds).toEqual(b.typeIds);
    expect(a.typeIds).toEqual([1, 7, 4]); // 1<2 tie, uniform 7, 4<9 tie — raw values unshifted
  });

  it('throws when the layer length is not width × height × 4', () => {
    // 6 half-cell bytes can't be a 2×1 grid (needs 8).
    expect(() => lmltToTerrainMap(layer([1, 1, 1, 1, 2, 2]), { width: 2, height: 1 })).toThrow(
      /lmlt layer has 6 bytes, expected 8/,
    );
  });
});

describe('decodeStringListChunk', () => {
  /** Builds a raw string-list chunk payload: [u32 count] then per entry [u8 len][bytes][0x00]. */
  const listChunk = (names: string[]): MapDatChunk => {
    const bytes: number[] = [names.length & 0xff, (names.length >>> 8) & 0xff, 0, 0];
    for (const n of names) {
      bytes.push(n.length);
      for (let i = 0; i < n.length; i++) bytes.push(n.charCodeAt(i) & 0xff);
      bytes.push(0);
    }
    const payload = Uint8Array.from(bytes);
    return {
      tag: 'eapd',
      id: 0,
      version: 1,
      length: payload.length,
      depth: 0,
      checksum: 0,
      payloadOffset: 0,
      payload,
    };
  };

  it('decodes the count-prefixed length-prefixed name list', () => {
    expect(decodeStringListChunk(listChunk(['meadow 01', 'block water 00 00 00', '']))).toEqual([
      'meadow 01',
      'block water 00 00 00',
      '',
    ]);
  });

  it('round-trips an empty list', () => {
    expect(decodeStringListChunk(listChunk([]))).toEqual([]);
  });

  it('throws on a count that overruns the payload', () => {
    const chunk = listChunk(['abc']);
    const truncated = { ...chunk, payload: chunk.payload.slice(0, chunk.payload.length - 2) };
    expect(() => decodeStringListChunk(truncated)).toThrow(/overruns|truncated/);
  });

  it('throws on a payload too short for the header', () => {
    const chunk = { ...listChunk([]), payload: Uint8Array.from([1, 0]) };
    expect(() => decodeStringListChunk(chunk)).toThrow(/too short/);
  });
});
