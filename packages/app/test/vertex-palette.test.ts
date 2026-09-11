import { describe, expect, it } from 'vitest';
import { vertexPaletteFromPcx } from '../src/content/vertex-palette.js';

function carrier(): Uint8Array {
  const bytes = new Uint8Array(128 + 1 + 768);
  bytes[0] = 10;
  bytes[3] = 8;
  bytes[65] = 1;
  bytes[128] = 12;
  bytes.set([128, 121, 115], 129 + 3);
  return bytes;
}

describe('terrain vertex palette', () => {
  it('keeps color channels from the palette, independent of image pixels', () => {
    const palette = vertexPaletteFromPcx(carrier());
    expect(palette).toHaveLength(256);
    expect(palette?.[1]).toBe(0x807973);
  });

  it('refuses truncated, non-indexed and missing-trailer carriers', () => {
    expect(vertexPaletteFromPcx(new Uint8Array(768))).toBeNull();
    for (const offset of [0, 3, 65, 128]) {
      const bytes = carrier();
      bytes[offset] = 0;
      expect(vertexPaletteFromPcx(bytes)).toBeNull();
    }
  });
});
