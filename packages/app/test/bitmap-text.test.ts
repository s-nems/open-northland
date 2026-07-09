import { describe, expect, it } from 'vitest';
import { CP1250_HIGH_ENTRIES, cp1250Byte } from '../src/hud/bitmap-text.js';

/**
 * Pins the hand-typed Unicode→CP1250 glyph mapping to the real code page via the platform decoder —
 * a typo'd entry would otherwise regress as silently missing/wrong glyphs in the HUD text.
 */
describe('bitmap-text CP1250 glyph mapping', () => {
  const decoder = new TextDecoder('windows-1250');

  it('maps every high-codepoint entry to the byte the code page decodes back to it', () => {
    for (const [codepoint, byte] of CP1250_HIGH_ENTRIES) {
      expect(decoder.decode(Uint8Array.of(byte))).toBe(String.fromCodePoint(codepoint));
    }
  });

  it('covers the full Polish alphabet beyond Latin-1', () => {
    for (const ch of 'ĄąĆćĘęŁłŃńŚśŹźŻż') {
      const codepoint = ch.codePointAt(0) as number;
      expect(cp1250Byte(codepoint), `missing mapping for ${ch}`).toBeDefined();
    }
  });

  it('passes Latin-1-range codepoints through unchanged and rejects unmapped high ones', () => {
    expect(cp1250Byte('ó'.codePointAt(0) as number)).toBe(0xf3);
    expect(cp1250Byte(0x40)).toBe(0x40);
    expect(cp1250Byte(0x4e00)).toBeUndefined(); // CJK — no CP1250 slot
  });
});
