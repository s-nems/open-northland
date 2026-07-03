import { describe, expect, it } from 'vitest';
import {
  BOB_TYPE_8BIT,
  BOB_TYPE_EMPTY,
  type Bmd,
  type BobRecord,
  PACKED_X_SHIFT,
} from '../src/decoders/bmd.js';
import { StorableId } from '../src/decoders/cif.js';
import {
  FONT_FIRST_CHAR,
  FONT_SPACE_BOB_ID,
  type Font,
  bobAdvance,
  decodeFnt,
  deriveBaseline,
  deriveLineHeight,
  encodeFnt,
  fontMetrics,
} from '../src/decoders/fnt.js';

/**
 * `.fnt` (CFont) decoder tests. No copyrighted fixtures: we synthesize a CFont — the 16-byte font prefix
 * in front of a hand-built `.bmd` bob container — and assert the envelope parse, the `encodeFnt`/`decodeFnt`
 * round-trip, and the layout metrics ported from `CFont.cs` (advance, line height, baseline, the space→bob
 * 0x49 whitespace rule). The bob-pixel decode itself is covered by the `.bmd`/atlas tests.
 */

/** A tiny valid `.bmd` (2 8-bit bobs with pixels), the same shape a real CBobManager round-trips through. */
const sampleBmd = (): Bmd => ({
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
  lineControl: Uint32Array.from([(0 << PACKED_X_SHIFT) | 0, (0 << PACKED_X_SHIFT) | 4]),
});

/** A metrics-only glyph container: `count` bob records, all empty except the ones in `set` (a bobId→area map). */
const metricsBmd = (count: number, set: Record<number, BobRecord['area']>): Bmd => {
  const bobs: BobRecord[] = [];
  for (let i = 0; i < count; i++) {
    const area = set[i];
    bobs.push(
      area !== undefined
        ? { type: BOB_TYPE_8BIT, area, misc: 0 }
        : { type: BOB_TYPE_EMPTY, area: { x: 0, y: 0, width: 0, height: 0 }, misc: 0 },
    );
  }
  return {
    version: 0,
    firstBobId: 0,
    bobCount: count,
    generatedNonEmptyLines: 0,
    generatedEmptyLines: 0,
    generatedPackedLines: 0,
    bobs,
    packedLineData: new Uint8Array(0),
    lineControl: new Uint32Array(0),
  };
};

const AT_A = 'A'.charCodeAt(0) - FONT_FIRST_CHAR; // bob id of 'A' (a reference capital)

describe('decodeFnt / encodeFnt', () => {
  it('round-trips a CFont (prefix words + the nested bob container)', () => {
    const font: Font = { version: 0, value08: 223, value0C: 10, bmd: sampleBmd() };
    const decoded = decodeFnt(encodeFnt(font));
    expect(decoded).toEqual(font);
  });

  it('reads the envelope: id 0x3F5, the two font words, then the nested CBobManager', () => {
    const font: Font = { version: 3, value08: 116, value0C: 8, bmd: sampleBmd() };
    const bytes = encodeFnt(font);
    // The first word is the CFont id; the nested container starts at offset 16 with the CBobManager id.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(StorableId.CFont);
    expect(dv.getUint32(16, true)).toBe(StorableId.CBobManager);
    const decoded = decodeFnt(bytes);
    expect([decoded.version, decoded.value08, decoded.value0C]).toEqual([3, 116, 8]);
    expect(decoded.bmd.bobCount).toBe(2);
  });

  it('throws on a wrong root id, a null nested storable, and a too-short buffer', () => {
    const good = encodeFnt({ version: 0, value08: 0, value0C: 0, bmd: sampleBmd() });

    const wrongId = Uint8Array.from(good);
    new DataView(wrongId.buffer).setUint32(0, StorableId.CBobManager, true); // 0x3F4, not a CFont
    expect(() => decodeFnt(wrongId)).toThrow(/not a CFont/);

    // A CFont whose nested storable header is (id 0, version 0) — the "null bob manager" CFont writes.
    const nullNested = new Uint8Array(20);
    new DataView(nullNested.buffer).setUint32(0, StorableId.CFont, true);
    expect(() => decodeFnt(nullNested)).toThrow(/no CBobManager/);

    expect(() => decodeFnt(new Uint8Array(8))).toThrow(/too short/);
  });
});

describe('fontMetrics', () => {
  // 74 glyphs so the space bob (0x49 = 73) exists; only 'A' and bob 0x49 carry pixels, the rest are empty.
  const font: Font = {
    version: 0,
    value08: 223,
    value0C: 10,
    bmd: metricsBmd(FONT_SPACE_BOB_ID + 1, {
      [AT_A]: { x: 1, y: 4, width: 5, height: 10 }, // a capital → advance 7, bottom (baseline) 14
      [FONT_SPACE_BOB_ID]: { x: 1, y: 4, width: 2, height: 10 }, // the space's advance source → advance 4
    }),
  };
  const metrics = fontMetrics(font);

  it('emits one glyph per bob, in ascending char order from 0x20', () => {
    expect(metrics.firstChar).toBe(FONT_FIRST_CHAR);
    expect(metrics.charCount).toBe(FONT_SPACE_BOB_ID + 1);
    expect(metrics.glyphs).toHaveLength(FONT_SPACE_BOB_ID + 1);
    metrics.glyphs.forEach((g, i) => expect(g.char).toBe(FONT_FIRST_CHAR + i));
  });

  it('advances a glyph by x + width + 1 (CFont GetCharacterWidth, spacing 0)', () => {
    const glyphA = metrics.glyphs[AT_A];
    expect(glyphA?.advance).toBe(1 + 5 + 1);
    expect([glyphA?.offsetX, glyphA?.offsetY, glyphA?.width, glyphA?.height]).toEqual([1, 4, 5, 10]);
    expect(glyphA?.empty).toBe(false);
  });

  it('gives SPACE the advance of bob 0x49, not its own empty bob 0', () => {
    const space = metrics.glyphs[0];
    expect(space?.char).toBe(FONT_FIRST_CHAR); // 0x20
    expect(space?.empty).toBe(true); // draws nothing (its own bob 0 is empty)
    expect(space?.advance).toBe(bobAdvance(font.bmd, FONT_SPACE_BOB_ID)); // = 1 + 2 + 1 = 4
    expect(metrics.spaceBobId).toBe(FONT_SPACE_BOB_ID);
  });

  it('derives line height (max extent) and a baseline (reference capital bottom)', () => {
    // Extent = h + y + 1; max over 'A'/0x49 (both 10+4+1=15) vs the empty fillers (0+0+1=1).
    expect(metrics.lineHeight).toBe(15);
    expect(deriveLineHeight(font.bmd)).toBe(15);
    // 'A' sits on the baseline; its bottom edge is y + h = 14 (the earlier reference caps are empty here).
    expect(metrics.baseline).toBe(14);
    expect(deriveBaseline(font.bmd)).toBe(14);
    expect(metrics.nominalSize).toBe(10); // value0C carried through as the observed size
  });

  it('applies an external spacing to every advance (CFont SetSpacing)', () => {
    const spaced = fontMetrics(font, 2);
    expect(spaced.glyphs[AT_A]?.advance).toBe(2 + 1 + 5 + 1); // spacing folded in
    expect(bobAdvance(font.bmd, AT_A, 2)).toBe(2 + 1 + 5 + 1);
  });
});
