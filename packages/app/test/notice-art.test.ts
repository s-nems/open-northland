import { describe, expect, it } from 'vitest';
import { PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import { noticeTint, recolourKey } from '../src/hud/dom/notice-art.js';

const TINT = 0x2060c0;

function recoloured(...rgba: number[]): number[] {
  const pixels = new Uint8ClampedArray(rgba);
  recolourKey(pixels, TINT);
  return [...pixels];
}

describe('notice art key', () => {
  it('gives a full key pixel the tint and keeps its alpha', () => {
    expect(recoloured(255, 0, 255, 200)).toEqual([0x20, 0x60, 0xc0, 200]);
  });

  it('keeps the painted shade and highlight steps', () => {
    // Half value: the tint at half brightness. Half whiteness: halfway from the tint to white.
    expect(recoloured(128, 0, 128, 255)).toEqual([16, 48, 96, 255]);
    const [r, g, b] = recoloured(255, 128, 255, 255);
    expect([r, g, b]).toEqual([144, 176, 224]);
  });

  it('leaves the other colours of the artwork alone', () => {
    const russet = [150, 60, 50, 255];
    const iron = [120, 120, 130, 255];
    const oak = [120, 80, 40, 255];
    const outline = [20, 4, 18, 255];
    for (const pixel of [russet, iron, oak, outline]) expect(recoloured(...pixel)).toEqual(pixel);
  });

  it('keeps a warm near-black outline pixel near black even where the key takes it', () => {
    // Just above the floor with red and blue in balance: inside the key, so only its darkness saves it.
    const NEAR_BLACK_MAX = 48;
    const [r, g, b, a] = recoloured(42, 30, 30, 255);
    expect(Math.max(r ?? 255, g ?? 255, b ?? 255)).toBeLessThan(NEAR_BLACK_MAX);
    expect(a).toBe(255);
  });
});

describe('noticeTint', () => {
  it('takes the seat colour through the session slots, and one fixed colour for no seat', () => {
    expect(noticeTint(1)).toBe(PLAYER_SWATCH_COLORS[1]);
    expect(noticeTint(1, () => 4)).toBe(PLAYER_SWATCH_COLORS[4]);
    expect(noticeTint(null)).toBe(noticeTint(null, () => 4));
    expect(PLAYER_SWATCH_COLORS).not.toContain(noticeTint(null));
  });
});
