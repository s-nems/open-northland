import { describe, expect, it } from 'vitest';
import {
  decodeMapDat,
  encodeMapDat,
  encodeMapSize,
  isPackedLayer,
  MAP_LAYER_CODEC_X6,
  MAP_LAYER_CODEC_X8,
  MAP_LAYER_HEADER_SIZE,
  MAP_LAYER_SUBFORMAT,
  packMapLayer,
  packX6elLayer,
  unpackMapLayer,
  unpackX6elLayer,
} from '../src/decoders/mapdat/index.js';

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
