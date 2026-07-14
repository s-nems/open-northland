import { type Bmd, BOB_TYPE_8BIT, encodeBmd, PACKED_X_SHIFT } from '../../src/decoders/bmd/index.js';

/** A packed line-control word: first non-transparent column (`xMin`) in the high bits, byte `offset` in the low. */
export const packLineControl = (xMin: number, offset: number): number =>
  ((xMin << PACKED_X_SHIFT) | offset) >>> 0;

/** One 8-bit bob (id firstBobId=10), a 2×1 raw run of indices [4,8], serialized as a real `.bmd`. */
export const sampleBmdBytes = (): Uint8Array => {
  const bmd: Bmd = {
    version: 0,
    firstBobId: 10,
    bobCount: 1,
    generatedNonEmptyLines: 0,
    generatedEmptyLines: 0,
    generatedPackedLines: 0,
    bobs: [{ type: BOB_TYPE_8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 }],
    packedLineData: Uint8Array.from([0x02, 4, 8, 0x00]),
    lineControl: Uint32Array.from([packLineControl(0, 0)]),
  };
  return encodeBmd(bmd);
};

/** A tiny valid glyph/bob container (2 8-bit bobs with pixels), as a decoded `Bmd`. */
export const sampleGlyphBmd = (): Bmd => ({
  version: 0,
  firstBobId: 0,
  bobCount: 2,
  generatedNonEmptyLines: 0,
  generatedEmptyLines: 0,
  generatedPackedLines: 0,
  bobs: [
    { type: BOB_TYPE_8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 },
    { type: BOB_TYPE_8BIT, area: { x: 0, y: 0, width: 1, height: 1 }, misc: 1 },
  ],
  packedLineData: Uint8Array.from([0x02, 4, 8, 0x00, 0x01, 5, 0x00]),
  lineControl: Uint32Array.from([packLineControl(0, 0), packLineControl(0, 4)]),
});
