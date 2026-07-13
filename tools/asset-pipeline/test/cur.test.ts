import { describe, expect, it } from 'vitest';
import { type CursorImageInput, decodeCursor, encodeCursor } from '../src/decoders/cur.js';

/**
 * `.cur` decoder tests. No copyrighted fixtures: we synthesize `.cur` byte streams with the faithful
 * 8-bpp `encodeCursor` and decode them back, asserting pixels, the AND-mask transparency, the hotspot,
 * and the highest-depth/largest image selection. A real game cursor packs 1/4/8-bpp variants of one
 * 32×32 image; the synthetic single-depth fixtures exercise the same directory + DIB path.
 */

/** A 256-entry RGB palette where index i → (i, (2i)&0xff, (3i)&0xff) — distinct per index, easy to assert. */
const rampPalette = (): Uint8Array => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i & 0xff;
    p[i * 3 + 1] = (i * 2) & 0xff;
    p[i * 3 + 2] = (i * 3) & 0xff;
  }
  return p;
};

const image = (over: Partial<CursorImageInput>): CursorImageInput => ({
  width: 2,
  height: 2,
  hotspotX: 1,
  hotspotY: 1,
  pixels: Uint8Array.from([1, 2, 3, 4]),
  palette: rampPalette(),
  ...over,
});

const px = (img: { width: number; rgba: Uint8Array }, x: number, y: number): number[] => {
  const o = (y * img.width + x) * 4;
  return [...img.rgba.subarray(o, o + 4)];
};

describe('decodeCursor', () => {
  it('round-trips an 8-bpp image: palette-coloured pixels, opaque alpha, hotspot, size', () => {
    const cur = decodeCursor(encodeCursor([image({})]));
    expect(cur.width).toBe(2);
    expect(cur.height).toBe(2);
    expect(cur.hotspotX).toBe(1);
    expect(cur.hotspotY).toBe(1);
    // Each pixel is palette[index] in RGB with alpha 255 (index i → (i, 2i, 3i)).
    expect(px(cur.image, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(px(cur.image, 1, 0)).toEqual([2, 4, 6, 255]);
    expect(px(cur.image, 0, 1)).toEqual([3, 6, 9, 255]);
    expect(px(cur.image, 1, 1)).toEqual([4, 8, 12, 255]);
  });

  it('makes AND-masked pixels fully transparent', () => {
    // Mark the top-right pixel transparent; it must decode to all-zero RGBA regardless of its index.
    const cur = decodeCursor(encodeCursor([image({ transparent: Uint8Array.from([0, 1, 0, 0]) })]));
    expect(px(cur.image, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(px(cur.image, 0, 0)).toEqual([1, 2, 3, 255]); // its neighbour stays opaque
  });

  it('selects the largest image when the directory packs several depths/sizes', () => {
    // A 1×1 and a 2×2 image (both 8-bpp) → the 2×2 wins on area.
    const cur = decodeCursor(
      encodeCursor([image({ width: 1, height: 1, pixels: Uint8Array.from([9]) }), image({})]),
    );
    expect(cur.width).toBe(2);
    expect(cur.height).toBe(2);
  });

  it('reads the hotspot from the SELECTED (chosen) image, not directory entry 0', () => {
    // Entry 0 is a small fallback carrying a stray hotspot (5,6); the larger entry 1 is selected for
    // pixels and carries (7,8). Both the pixels AND the hotspot must come from the selected entry —
    // matching the original's Win32 best-fit (it uses the chosen image's own hotspot). This is why the
    // real MouseRight resolves (1,1) from its 8-bpp entry, not the (10,10) on its 1-bpp fallback.
    const cur = decodeCursor(
      encodeCursor([
        image({ width: 1, height: 1, pixels: Uint8Array.from([0]), hotspotX: 5, hotspotY: 6 }),
        image({ hotspotX: 7, hotspotY: 8 }),
      ]),
    );
    expect(cur.width).toBe(2); // the larger image supplied the pixels...
    expect([cur.hotspotX, cur.hotspotY]).toEqual([7, 8]); // ...and its own hotspot
  });

  it('throws on a non-cursor buffer and on an empty directory', () => {
    const notCursor = new Uint8Array(6);
    new DataView(notCursor.buffer).setUint16(2, 7, true); // ICONDIR type 7 (neither icon nor cursor)
    expect(() => decodeCursor(notCursor)).toThrow(/cursor:/);

    const empty = new Uint8Array(6);
    new DataView(empty.buffer).setUint16(2, 2, true); // type cursor, count 0
    expect(() => decodeCursor(empty)).toThrow(/no images/);
  });
});
