import { describe, expect, it } from 'vitest';
import {
  type Bmd,
  type BobRecord,
  PACKED_OFFSET_MASK,
  PACKED_X_SHIFT,
  decodeBmd,
  encodeBmd,
} from '../src/decoders/bmd.js';

/**
 * `.bmd` (CBobManager, id 0x3F4) container decoder tests. No copyrighted fixtures: we synthesize bob
 * sets in memory with the faithful `encodeBmd`, then assert `decodeBmd` recovers the header, records,
 * and the two raw blocks. A couple of cases hand-build bytes to pin the storable header + the 24-byte
 * record layout against the OpenVikings format, and one exercises the line-control packing constants.
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
  lineControl: Uint32Array.from([0, 0xffffffff, (5 << PACKED_X_SHIFT) | 2]),
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
    const ctrl = (12 << PACKED_X_SHIFT) | 345;
    expect(ctrl >>> PACKED_X_SHIFT).toBe(12);
    expect(ctrl & PACKED_OFFSET_MASK).toBe(345);
  });
});
