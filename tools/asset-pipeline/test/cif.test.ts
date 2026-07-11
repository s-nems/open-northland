import { describe, expect, it } from 'vitest';
import { decodeCifStringArray, decryptMode1, encryptMode1, StorableId } from '../src/decoders/cif.js';

/**
 * `.cif` container decoder tests. No copyrighted fixtures are committed: we synthesize a
 * CStringArray container in memory (encrypting it with the faithful port of XB_Encrypt_Memory),
 * then assert the decoder recovers it. The structure mirrors the real `housetypes.cif` verified
 * during the Phase-1 spike.
 */

const NUL = 0x00;

/** Encodes lines like the real pool: [levelByte][latin1 text][NUL]. Returns pool + offsets table. */
function buildPool(lines: ReadonlyArray<{ level: number; text: string }>): {
  pool: Uint8Array;
  offsets: Uint8Array;
} {
  const chunks: number[] = [];
  const offsetValues: number[] = [];
  for (const { level, text } of lines) {
    offsetValues.push(chunks.length);
    if (level > 0) chunks.push(level); // level 0 = no control byte; text starts directly (>= 0x20)
    for (const ch of text) chunks.push(ch.charCodeAt(0) & 0xff);
    chunks.push(NUL);
  }
  const offsets = new Uint8Array(offsetValues.length * 4);
  const ov = new DataView(offsets.buffer);
  offsetValues.forEach((v, i) => {
    ov.setUint32(i * 4, v, true);
  });
  return { pool: Uint8Array.from(chunks), offsets };
}

/** Serializes a CStringArray `.cif`, encrypting the offsets + pool exactly as the original does. */
function buildCif(lines: ReadonlyArray<{ level: number; text: string }>): Uint8Array {
  const { pool, offsets } = buildPool(lines);
  const encOffsets = Uint8Array.from(offsets);
  const encPool = Uint8Array.from(pool);
  encryptMode1(encOffsets);
  encryptMode1(encPool);

  const out: number[] = [];
  const pushU32 = (v: number): void => {
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const pushCMemory = (data: Uint8Array): void => {
    pushU32(StorableId.CMemory);
    pushU32(0); // version
    pushU32(data.length);
    for (const byte of data) out.push(byte);
  };

  pushU32(StorableId.CStringArray);
  pushU32(0); // version
  pushU32(1); // forceSequentialIds
  pushU32(lines.length); // stringCount
  pushU32(lines.length); // usedIdCount
  pushU32(lines.length); // slotCount
  pushU32(pool.length); // stringPoolUsedBytes
  pushCMemory(encOffsets);
  out.push(1); // hasStringPool flag
  pushCMemory(encPool);
  return Uint8Array.from(out);
}

describe('Mode1 cipher', () => {
  it('decrypt inverts encrypt for all lengths (odd tail included)', () => {
    for (const len of [0, 1, 2, 3, 16, 17, 255]) {
      const original = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      const buf = Uint8Array.from(original);
      encryptMode1(buf);
      if (len > 0) expect(buf).not.toEqual(original); // actually transformed
      decryptMode1(buf);
      expect(buf).toEqual(original);
    }
  });

  it('matches the known keystream start (first byte uses key 0x47)', () => {
    // out0 = (in0 - 1) ^ 0x47  =>  encrypt of 0x00 is ((0x00 ^ 0x47) + 1) = 0x48
    const buf = Uint8Array.from([0x00]);
    encryptMode1(buf);
    expect(buf[0]).toBe(0x48);
  });
});

describe('decodeCifStringArray', () => {
  it('decodes a synthetic housetypes-shaped container', () => {
    const lines = [
      { level: 1, text: 'logichousetype' },
      { level: 2, text: 'debugname "headquarters"' },
      { level: 2, text: 'logictype 1' },
      { level: 2, text: 'logicstock 16 100 0' },
    ];
    const cif = decodeCifStringArray(buildCif(lines));

    expect(cif.forceSequentialIds).toBe(true);
    expect(cif.stringCount).toBe(4);
    expect(cif.slotCount).toBe(4);
    expect(cif.lines).toEqual(lines);
  });

  it('decodes a level-0 line (text not prefixed by a control byte)', () => {
    const lines = [{ level: 0, text: 'no level byte here' }];
    const cif = decodeCifStringArray(buildCif(lines));
    expect(cif.lines).toEqual(lines);
  });

  it('skips hole slots (INVALID offsets) and preserves canonical id order', () => {
    // Build a pool with two real strings; inject a hole between them via the offsets table.
    const real = [
      { level: 1, text: 'first' },
      { level: 2, text: 'third' },
    ];
    const { pool } = buildPool(real);
    const firstOff = 0;
    const secondOff = pool.indexOf(0) + 1; // byte after the first NUL
    const offsets = new Uint8Array(3 * 4);
    const ov = new DataView(offsets.buffer);
    ov.setUint32(0, firstOff, true);
    ov.setUint32(4, 0xffffffff, true); // hole
    ov.setUint32(8, secondOff, true);

    const encOffsets = Uint8Array.from(offsets);
    const encPool = Uint8Array.from(pool);
    encryptMode1(encOffsets);
    encryptMode1(encPool);

    const out: number[] = [];
    const pushU32 = (v: number): void =>
      void out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    const pushCMemory = (data: Uint8Array): void => {
      pushU32(StorableId.CMemory);
      pushU32(0);
      pushU32(data.length);
      for (const byte of data) out.push(byte);
    };
    pushU32(StorableId.CStringArray);
    pushU32(0);
    pushU32(1); // forceSequentialIds
    pushU32(2); // stringCount
    pushU32(2); // usedIdCount
    pushU32(3); // slotCount (incl. the hole)
    pushU32(pool.length);
    pushCMemory(encOffsets);
    out.push(1);
    pushCMemory(encPool);

    const cif = decodeCifStringArray(Uint8Array.from(out));
    expect(cif.slotCount).toBe(3);
    expect(cif.lines).toEqual(real); // hole skipped, order preserved
  });

  it('returns no lines when hasStringPool is 0', () => {
    const out: number[] = [];
    const pushU32 = (v: number): void =>
      void out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    pushU32(StorableId.CStringArray);
    pushU32(0);
    pushU32(0); // forceSequentialIds
    pushU32(0); // stringCount
    pushU32(0); // usedIdCount
    pushU32(0); // slotCount
    pushU32(0); // stringPoolUsedBytes
    // empty offsets CMemory
    pushU32(StorableId.CMemory);
    pushU32(0);
    pushU32(0);
    out.push(0); // hasStringPool = 0

    const cif = decodeCifStringArray(Uint8Array.from(out));
    expect(cif.lines).toEqual([]);
  });

  it('rejects a non-CStringArray root', () => {
    const bad = new Uint8Array(8); // id 0, version 0
    expect(() => decodeCifStringArray(bad)).toThrow(/not a CStringArray/);
  });

  it('throws a cif-prefixed error on a truncated header (not a raw RangeError)', () => {
    expect(() => decodeCifStringArray(new Uint8Array(0))).toThrow(/cif: read of 4 bytes overruns/);
    expect(() => decodeCifStringArray(new Uint8Array(6))).toThrow(/cif: read of 4 bytes overruns/);
  });
});
