import { describe, expect, it } from 'vitest';
import {
  PLAYER_COLORS,
  PLAYER_COLOR_BANDS,
  PLAYER_COLOR_COUNT,
  PLAYER_RAMP_START,
  buildPlayerLutImage,
  composePlayerPalette,
  isPlayerColorIndex,
  synthesizePlayerSource,
} from '../src/decoders/player-palette.js';

/**
 * Player-palette maths tests. No copyrighted fixtures: synthetic 768-byte RGB palettes with distinct,
 * easy-to-assert values. Covers the band predicate, band composition (only the band is swapped), the
 * hue-rotation synthesiser (hue changes, greys stay neutral, non-band untouched), and the LUT image
 * stacking + its guards.
 */

/** A 256-colour palette where index `i` → `(i, i, i)` (a grey ramp — trivially distinct per index). */
const greyRamp = (): Uint8Array => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p.fill(i, i * 3, i * 3 + 3);
  return p;
};

/** A 256-colour palette all set to one RGB triple. */
const solid = (r: number, g: number, b: number): Uint8Array => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = r;
    p[i * 3 + 1] = g;
    p[i * 3 + 2] = b;
  }
  return p;
};

describe('isPlayerColorIndex', () => {
  it('covers the clothing patches (5/10/15) only, not the source-ramp indices', () => {
    expect(PLAYER_COLOR_BANDS).toEqual([
      [80, 95],
      [160, 175],
      [240, 255],
    ]);
    // In the target bands
    for (const i of [80, 90, 95, 160, 175, 240, 255]) expect(isPlayerColorIndex(i)).toBe(true);
    // Out of band — incl. the source ramp (16–31) which is NOT a target band
    for (const i of [0, 16, 31, 79, 96, 159, 223, 239]) expect(isPlayerColorIndex(i)).toBe(false);
  });
});

describe('composePlayerPalette', () => {
  it('writes the source ramp (idx 16..31) into every clothing patch; base elsewhere', () => {
    const base = solid(10, 20, 30);
    // A source whose index i has colour (i, 0, 0), so we can check the ramp maps 16..31 → 80.., 160.., 240..
    const source = new Uint8Array(768);
    for (let i = 0; i < 256; i++) source[i * 3] = i;
    const out = composePlayerPalette(base, source);
    expect(out.length).toBe(768);
    for (const [lo] of PLAYER_COLOR_BANDS) {
      for (let k = 0; k < 16; k++) {
        const o = (lo + k) * 3;
        // band[lo+k] = source[16+k] = (16+k, 0, 0)
        expect([out[o], out[o + 1], out[o + 2]]).toEqual([PLAYER_RAMP_START + k, 0, 0]);
      }
    }
    // A non-band index keeps the base colour.
    expect([out[100 * 3], out[100 * 3 + 1], out[100 * 3 + 2]]).toEqual([10, 20, 30]);
  });

  it('does not mutate its inputs', () => {
    const base = greyRamp();
    const source = solid(1, 2, 3);
    const baseCopy = base.slice();
    composePlayerPalette(base, source);
    expect(base).toEqual(baseCopy);
  });

  it('throws on a wrong-sized palette', () => {
    expect(() => composePlayerPalette(new Uint8Array(767), solid(0, 0, 0))).toThrow(/768 bytes/);
  });

  it('does not alias the base when it is a Node Buffer (Buffer.slice shares memory)', () => {
    // A decoded .pcx palette IS a Buffer; a naive `base.slice()` would return a shared view, so composing
    // twice would corrupt the base and both results would collapse to the last ramp. Guard against that.
    const base = Buffer.alloc(768, 7); // every byte 7
    const before = Uint8Array.from(base);
    const blue = composePlayerPalette(base, solid(0, 0, 200));
    const red = composePlayerPalette(base, solid(200, 0, 0));
    expect(Uint8Array.from(base)).toEqual(before); // base untouched
    expect([blue[80 * 3], blue[80 * 3 + 1], blue[80 * 3 + 2]]).toEqual([0, 0, 200]);
    expect([red[80 * 3], red[80 * 3 + 1], red[80 * 3 + 2]]).toEqual([200, 0, 0]);
  });
});

describe('synthesizePlayerSource', () => {
  it('hue-rotates the source ramp (idx 16..31) while keeping saturation/value; leaves the rest untouched', () => {
    const ref = solid(255, 0, 0); // pure red everywhere (hue 0, s=1, v=1)
    const out = synthesizePlayerSource(ref, 240); // ramp → pure blue
    for (let i = 0; i < 256; i++) {
      const o = i * 3;
      if (i >= PLAYER_RAMP_START && i < PLAYER_RAMP_START + 16) {
        expect([out[o], out[o + 1], out[o + 2]]).toEqual([0, 0, 255]);
      } else {
        expect([out[o], out[o + 1], out[o + 2]]).toEqual([255, 0, 0]); // outside the ramp unchanged
      }
    }
  });

  it('keeps greys neutral (hue is meaningless at zero saturation)', () => {
    const ref = solid(128, 128, 128);
    const out = synthesizePlayerSource(ref, 90);
    const o = PLAYER_RAMP_START * 3;
    expect([out[o], out[o + 1], out[o + 2]]).toEqual([128, 128, 128]);
  });
});

describe('buildPlayerLutImage', () => {
  it('stacks palettes into a 256×N RGBA image, one row per palette, alpha 255', () => {
    const a = solid(1, 2, 3);
    const b = solid(4, 5, 6);
    const img = buildPlayerLutImage([a, b]);
    expect(img.width).toBe(256);
    expect(img.height).toBe(2);
    // Row 0 = palette a, row 1 = palette b; alpha always opaque.
    const px = (x: number, y: number): number[] => {
      const o = (y * 256 + x) * 4;
      return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]];
    };
    expect(px(0, 0)).toEqual([1, 2, 3, 255]);
    expect(px(255, 0)).toEqual([1, 2, 3, 255]);
    expect(px(128, 1)).toEqual([4, 5, 6, 255]);
  });

  it('throws on an empty list or a wrong-sized palette', () => {
    expect(() => buildPlayerLutImage([])).toThrow(/at least one/);
    expect(() => buildPlayerLutImage([new Uint8Array(100)])).toThrow(/768 bytes/);
  });
});

describe('PLAYER_COLORS', () => {
  it('defines 16 colours with ids 0..15 in order; 0..9 from pcx, 10..15 synthetic', () => {
    expect(PLAYER_COLORS.length).toBe(PLAYER_COLOR_COUNT);
    PLAYER_COLORS.forEach((c, i) => {
      expect(c.id).toBe(i);
      expect(c.source.kind).toBe(i < 10 ? 'pcx' : 'synthetic');
    });
    expect(PLAYER_COLORS[0]?.name).toBe('blue'); // the human player's default
  });
});
