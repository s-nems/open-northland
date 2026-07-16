import { describe, expect, it } from 'vitest';
import {
  type Bmd,
  BOB_ALPHA_OPAQUE,
  BOB_MASK_INDEX,
  BOB_TYPE_1BIT,
  BOB_TYPE_8BIT,
  BOB_TYPE_DOUBLE8BIT,
  BOB_TYPE_EMPTY,
  BOB_TYPE_TIMEMASK,
  type BobRecord,
  decodeBmd,
  decodeBobFrame,
  encodeBmd,
  PACKED_OFFSET_MASK,
  PACKED_X_SHIFT,
} from '../src/decoders/bmd/index.js';
import { packLineControl } from './fixtures/bmd.js';

/**
 * `.bmd` (CBobManager, id 0x3F4) container decoder tests. No copyrighted fixtures: we synthesize bob
 * sets in memory with the faithful `encodeBmd`, then assert `decodeBmd` recovers the header, records,
 * and the two raw blocks. A couple of cases hand-build bytes to pin the storable header + the 24-byte
 * record layout through a synthetic round trip, and one exercises the line-control packing constants.
 */

/** A bob record with the given rectangle; type/misc default to distinguishable values. */
const bob = (overrides: Partial<BobRecord> = {}): BobRecord => ({
  type: 1,
  area: { x: 0, y: 0, width: 4, height: 3 },
  misc: 0,
  ...overrides,
});

/** A minimal non-empty Bmd with `count` bobs and a few packed-line / control bytes. */
const sampleBmd = (count: number): Bmd => ({
  version: 0,
  firstBobId: 100,
  bobCount: count,
  generatedNonEmptyLines: 7,
  generatedEmptyLines: 2,
  generatedPackedLines: 3,
  bobs: Array.from({ length: count }, (_, i) =>
    bob({ type: i + 1, area: { x: i, y: i * 2, width: 4 + i, height: 3 }, misc: 0xdead0000 + i }),
  ),
  packedLineData: Uint8Array.from([0, 1, 2, 3, 4, 5]),
  lineControl: Uint32Array.from([0, 0xffffffff, packLineControl(5, 2)]),
});

describe('decodeBmd / encodeBmd', () => {
  it('round-trips a non-empty bob set', () => {
    const original = sampleBmd(3);
    const decoded = decodeBmd(encodeBmd(original));

    expect(decoded.version).toBe(0);
    expect(decoded.firstBobId).toBe(100);
    expect(decoded.bobCount).toBe(3);
    expect(decoded.generatedNonEmptyLines).toBe(7);
    expect(decoded.generatedEmptyLines).toBe(2);
    expect(decoded.generatedPackedLines).toBe(3);
    expect(decoded.bobs).toEqual(original.bobs);
    expect([...decoded.packedLineData]).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...decoded.lineControl]).toEqual([...original.lineControl]);
  });

  it('round-trips an empty bob set without writing CMemory blocks', () => {
    const empty: Bmd = {
      version: 0,
      firstBobId: 0,
      bobCount: 0,
      generatedNonEmptyLines: 0,
      generatedEmptyLines: 0,
      generatedPackedLines: 0,
      bobs: [],
      packedLineData: new Uint8Array(0),
      lineControl: new Uint32Array(0),
    };
    const bytes = encodeBmd(empty);
    // Header only: [id][ver] + 7 u32 fields = 9 × 4 = 36 bytes.
    expect(bytes.length).toBe(36);
    expect(decodeBmd(bytes)).toEqual(empty);
  });

  it('preserves negative rectangle offsets (signed i32 fields)', () => {
    const original = sampleBmd(1);
    const withNeg: Bmd = {
      ...original,
      bobs: [bob({ type: 9, area: { x: -2, y: -1, width: 6, height: 5 }, misc: 0 })],
    };
    const decoded = decodeBmd(encodeBmd(withNeg));
    expect(decoded.bobs[0]?.area).toEqual({ x: -2, y: -1, width: 6, height: 5 });
  });

  it('round-trips a full-width misc / line-control word (u32, unsigned)', () => {
    const original = sampleBmd(1);
    const big: Bmd = {
      ...original,
      bobs: [bob({ misc: 0xffffffff })],
      lineControl: Uint32Array.from([0xffffffff]),
    };
    const decoded = decodeBmd(encodeBmd(big));
    expect(decoded.bobs[0]?.misc).toBe(0xffffffff);
    expect(decoded.lineControl[0]).toBe(0xffffffff);
  });

  it('decodes a hand-built header (pins the 0x3F4 root + field order)', () => {
    // id 0x3F4, ver 0, firstBobId 5, bobCount 0, then four zero counters.
    const buf = new Uint8Array(36);
    const v = new DataView(buf.buffer);
    v.setUint32(0, 0x3f4, true);
    v.setUint32(4, 0, true);
    v.setUint32(8, 5, true); // firstBobId
    v.setUint32(12, 0, true); // bobCount
    const decoded = decodeBmd(buf);
    expect(decoded.firstBobId).toBe(5);
    expect(decoded.bobCount).toBe(0);
  });

  it('decodes a hand-built 24-byte record from the bob-data CMemory', () => {
    const w: number[] = [];
    const push32 = (n: number) => {
      w.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    };
    // header: id, ver, firstBobId=0, bobCount=1, packedUsed=0, lineCtrlCount=0, 3 counters
    push32(0x3f4);
    push32(0);
    push32(0);
    push32(1);
    push32(0);
    push32(0);
    push32(0);
    push32(0);
    push32(0);
    // bob-data CMemory: id 0x3E9, ver 0, size 24, then the record.
    push32(0x3e9);
    push32(0);
    push32(24);
    push32(0x11); // type
    push32(0x22); // x
    push32(0x33); // y
    push32(0x44); // width
    push32(0x55); // height
    push32(0x66); // misc
    // packed-line CMemory (empty) + line-control CMemory (empty).
    push32(0x3e9);
    push32(0);
    push32(0);
    push32(0x3e9);
    push32(0);
    push32(0);

    const decoded = decodeBmd(Uint8Array.from(w));
    expect(decoded.bobs[0]).toEqual({
      type: 0x11,
      area: { x: 0x22, y: 0x33, width: 0x44, height: 0x55 },
      misc: 0x66,
    });
  });

  it('clamps the packed-line block to the header used-bytes (ignores CMemory slack)', () => {
    // Hand-build a bob set whose packed-line CMemory is allocated larger than the logical used-bytes
    // (the original allocator can leave slack). The decoder must return only `usedBytes` of it.
    const w: number[] = [];
    const push32 = (n: number) => {
      w.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    };
    push32(0x3f4); // id
    push32(0); // version
    push32(0); // firstBobId
    push32(1); // bobCount
    push32(3); // packedLineDataUsedBytes = 3 (logical)
    push32(0); // lineControlCount
    push32(0);
    push32(0);
    push32(0);
    // bob-data CMemory: one 24-byte record.
    push32(0x3e9);
    push32(0);
    push32(24);
    for (let i = 0; i < 24; i++) w.push(0);
    // packed-line CMemory: declared/allocated 6 bytes, but only the first 3 are logical.
    push32(0x3e9);
    push32(0);
    push32(6);
    w.push(0xaa, 0xbb, 0xcc, 0x99, 0x88, 0x77); // last 3 are slack
    // line-control CMemory (empty).
    push32(0x3e9);
    push32(0);
    push32(0);

    const decoded = decodeBmd(Uint8Array.from(w));
    expect([...decoded.packedLineData]).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('throws when the root storable id is not 0x3F4', () => {
    const buf = new Uint8Array(36);
    new DataView(buf.buffer).setUint32(0, 0x3e9, true); // CMemory id
    expect(() => decodeBmd(buf)).toThrow(/root is not a CBobManager/);
  });

  it('throws when a CMemory block is too short for the declared record count', () => {
    const w: number[] = [];
    const push32 = (n: number) => {
      w.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    };
    push32(0x3f4);
    push32(0);
    push32(0);
    push32(2); // bobCount = 2 -> needs 48 bytes
    push32(0);
    push32(0);
    push32(0);
    push32(0);
    push32(0);
    push32(0x3e9);
    push32(0);
    push32(24); // only one record's worth
    for (let i = 0; i < 24; i++) w.push(0);
    expect(() => decodeBmd(Uint8Array.from(w))).toThrow(/bob-data block is 24 bytes, need 48/);
  });

  it('throws on a buffer that ends mid-header', () => {
    // Valid 0x3F4 id+version (8 bytes) but the buffer stops before the 7 header fields.
    const buf = new Uint8Array(12);
    new DataView(buf.buffer).setUint32(0, 0x3f4, true);
    expect(() => decodeBmd(buf)).toThrow(/overruns buffer/);
  });

  it('rejects a Bmd whose bobs.length disagrees with bobCount', () => {
    const bad: Bmd = { ...sampleBmd(2), bobs: [bob()] };
    expect(() => encodeBmd(bad)).toThrow(/does not match bobCount/);
  });
});

describe('line-control packing constants', () => {
  it('split a control word into xMin and packed offset', () => {
    const ctrl = packLineControl(12, 345);
    expect(ctrl >>> PACKED_X_SHIFT).toBe(12);
    expect(ctrl & PACKED_OFFSET_MASK).toBe(345);
  });
});

/**
 * `decodeBobFrame` packed-line RLE -> indexed pixels tests. Each case hand-builds a tiny `Bmd` with one
 * bob, a packed-line byte stream, and per-row line-control words, then asserts the decoded frame's
 * `pixels`/`mask`. In the packed codec, `0` terminates a line, a
 * byte with the high bit clear is a raw run of `count = b & 0x7F` pixels (data inline), high bit set is
 * a transparent skip run of `count`. The control word packs `[xMin (10b)][offset into packed data (22b)]`.
 */
const PACKED_EMPTY = 0xffffffff;

/** Builds a single-bob `Bmd` for the codec tests. Each `lines[y]` is the offset into `packed` for row y. */
const frameBmd = (
  type: number,
  width: number,
  height: number,
  packed: number[],
  lines: (number | { offset: number; xMin: number } | typeof PACKED_EMPTY)[],
  areaX = 0,
): Bmd => ({
  version: 0,
  firstBobId: 0,
  bobCount: 1,
  generatedNonEmptyLines: 0,
  generatedEmptyLines: 0,
  generatedPackedLines: 0,
  bobs: [{ type, area: { x: areaX, y: 0, width, height }, misc: 0 }],
  packedLineData: Uint8Array.from(packed),
  lineControl: Uint32Array.from(
    lines.map((l) =>
      l === PACKED_EMPTY ? 0xffffffff : typeof l === 'number' ? l : packLineControl(l.xMin, l.offset),
    ),
  ),
});

describe('decodeBobFrame', () => {
  it('decodes an 8-bit raw run into indices with a full opaque mask', () => {
    // Row 0 at offset 0: raw run of 3 -> [0x05,0x07,0x09], then terminator 0.
    const bmd = frameBmd(BOB_TYPE_8BIT, 3, 1, [0x03, 0x05, 0x07, 0x09, 0x00], [0]);
    const frame = decodeBobFrame(bmd, 0);
    expect(frame.width).toBe(3);
    expect(frame.height).toBe(1);
    expect([...frame.pixels]).toEqual([0x05, 0x07, 0x09]);
    expect([...frame.mask]).toEqual([BOB_ALPHA_OPAQUE, BOB_ALPHA_OPAQUE, BOB_ALPHA_OPAQUE]);
  });

  it('honours xMin and skip runs (transparent gaps stay mask 0)', () => {
    // Frame width 6. Row 0 starts at xMin=1: raw run of 2 [0x11,0x22], skip 1, raw run of 1 [0x33].
    // Columns: 1,2 filled; 3 skipped; 4 filled; 0 and 5 never touched.
    const packed = [0x02, 0x11, 0x22, 0x81, 0x01, 0x33, 0x00];
    const bmd = frameBmd(BOB_TYPE_8BIT, 6, 1, packed, [{ offset: 0, xMin: 1 }]);
    const frame = decodeBobFrame(bmd, 0);
    expect([...frame.pixels]).toEqual([0x00, 0x11, 0x22, 0x00, 0x33, 0x00]);
    expect([...frame.mask]).toEqual([0, BOB_ALPHA_OPAQUE, BOB_ALPHA_OPAQUE, 0, BOB_ALPHA_OPAQUE, 0]);
  });

  it('treats a 0xFFFFFFFF control word as a fully transparent row', () => {
    const packed = [0x02, 0xaa, 0xbb, 0x00];
    // Row 0 transparent, row 1 draws two pixels at offset 0.
    const bmd = frameBmd(BOB_TYPE_8BIT, 2, 2, packed, [PACKED_EMPTY, 0]);
    const frame = decodeBobFrame(bmd, 0);
    expect([...frame.pixels]).toEqual([0x00, 0x00, 0xaa, 0xbb]);
    expect([...frame.mask]).toEqual([0, 0, BOB_ALPHA_OPAQUE, BOB_ALPHA_OPAQUE]);
  });

  it('decodes a 1-bit mask: a raw run is itself the coverage (no pixel bytes), skips stay transparent', () => {
    // Draw 1, skip 1, draw 1 -> cols 0 and 2 set, col 1 clear. Mask raw runs carry no data bytes
    // (pinned on the real shadow .bmds - only this reading decodes coherent silhouettes).
    const packed = [0x01, 0x81, 0x01, 0x00];
    const bmd = frameBmd(BOB_TYPE_1BIT, 3, 1, packed, [0]);
    const frame = decodeBobFrame(bmd, 0);
    expect([...frame.pixels]).toEqual([BOB_MASK_INDEX, 0x00, BOB_MASK_INDEX]);
    expect([...frame.mask]).toEqual([BOB_ALPHA_OPAQUE, 0, BOB_ALPHA_OPAQUE]);
  });

  it('decodes a double-byte bob: first byte is the index, the second its per-pixel alpha', () => {
    // Raw run of 2 double-pixels: [idx=0x40, a=0x99][idx=0x50, a=0x88], then terminator.
    const packed = [0x02, 0x40, 0x99, 0x50, 0x88, 0x00];
    const bmd = frameBmd(BOB_TYPE_DOUBLE8BIT, 2, 1, packed, [0]);
    const frame = decodeBobFrame(bmd, 0);
    expect([...frame.pixels]).toEqual([0x40, 0x50]);
    expect([...frame.mask]).toEqual([0x99, 0x88]);
  });

  it('keeps a double-byte pixel with alpha 0 fully unwritten (the engine skips a <= 0 pixels)', () => {
    const packed = [0x02, 0x40, 0x00, 0x50, 0xff, 0x00];
    const bmd = frameBmd(BOB_TYPE_DOUBLE8BIT, 2, 1, packed, [0]);
    const frame = decodeBobFrame(bmd, 0);
    // Neither the mask NOR the index is written — the frame invariant (unwritten = index 0, mask 0) holds.
    expect([...frame.pixels]).toEqual([0x00, 0x50]);
    expect([...frame.mask]).toEqual([0, 0xff]);
  });

  it('decodes a time-mask bob as [value, timeByte] pairs', () => {
    // Raw run of 2 pairs: [value=0x12, time=0x34][value=0x56, time=0x00] — a time of 0 is a REAL pixel
    // (visible from the start of construction), written opaque, unlike an alpha 0.
    const bmd = frameBmd(BOB_TYPE_TIMEMASK, 2, 1, [0x02, 0x12, 0x34, 0x56, 0x00, 0x00], [0]);
    const frame = decodeBobFrame(bmd, 0);
    expect([...frame.pixels]).toEqual([0x12, 0x56]);
    expect([...frame.mask]).toEqual([BOB_ALPHA_OPAQUE, BOB_ALPHA_OPAQUE]);
    expect([...(frame.time ?? [])]).toEqual([0x34, 0x00]);
  });

  it("decodes a double-byte bob's second byte as build-progress time when asked ('time' mode)", () => {
    // Same pairs as the alpha-0 case above: in 'time' mode the 0 byte no longer holes the pixel — it is
    // the threshold "appears at progress 0", and the colour plane bakes opaque (the finished PrintBob blit).
    const packed = [0x02, 0x40, 0x00, 0x50, 0xff, 0x00];
    const bmd = frameBmd(BOB_TYPE_DOUBLE8BIT, 2, 1, packed, [0]);
    const frame = decodeBobFrame(bmd, 0, 'time');
    expect([...frame.pixels]).toEqual([0x40, 0x50]);
    expect([...frame.mask]).toEqual([BOB_ALPHA_OPAQUE, BOB_ALPHA_OPAQUE]);
    expect([...(frame.time ?? [])]).toEqual([0x00, 0xff]);
  });

  it('yields an all-transparent frame for an empty (type 0) bob', () => {
    const bmd = frameBmd(BOB_TYPE_EMPTY, 2, 2, [], [0, 0]);
    const frame = decodeBobFrame(bmd, 0);
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
    expect([...frame.mask]).toEqual([0, 0, 0, 0]);
  });

  it('clips a run at the right frame edge (columns are local; area.x is the draw offset, not applied)', () => {
    // Frame width 2, raw run of 3 from local xMin=0 -> columns 0,1 land; column 2 is past the frame edge
    // and is clipped. area.x=2 is the DRAW offset and is NOT subtracted from the local column grid (doing
    // so was the bug that discarded the right side of every bob).
    const packed = [0x03, 0xa0, 0xb0, 0xc0, 0x00];
    const bmd = frameBmd(BOB_TYPE_8BIT, 2, 1, packed, [{ offset: 0, xMin: 0 }], 2);
    const frame = decodeBobFrame(bmd, 0);
    expect([...frame.pixels]).toEqual([0xa0, 0xb0]);
    expect([...frame.mask]).toEqual([BOB_ALPHA_OPAQUE, BOB_ALPHA_OPAQUE]);
  });

  it('tolerates a truncated raw run without throwing (stops like the clipped original)', () => {
    // Raw run claims 4 pixels but only 2 bytes of data exist before the buffer ends.
    const packed = [0x04, 0x01, 0x02];
    const bmd = frameBmd(BOB_TYPE_8BIT, 4, 1, packed, [0]);
    const frame = decodeBobFrame(bmd, 0);
    expect([...frame.pixels]).toEqual([0x01, 0x02, 0x00, 0x00]);
    expect([...frame.mask]).toEqual([BOB_ALPHA_OPAQUE, BOB_ALPHA_OPAQUE, 0, 0]);
  });

  it('throws on an out-of-range bob index', () => {
    const bmd = frameBmd(BOB_TYPE_8BIT, 1, 1, [0x01, 0x00, 0x00], [0]);
    expect(() => decodeBobFrame(bmd, 1)).toThrow(/out of range/);
    expect(() => decodeBobFrame(bmd, -1)).toThrow(/out of range/);
  });
});
