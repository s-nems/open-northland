import { describe, expect, it } from 'vitest';
import { SOLID_ALPHA_MIN, buildAlphaMask, maskSolidAt } from '../src/gpu/sprite-pool/alpha-mask.js';

/**
 * The pure half of pixel-accurate picking: RGBA → 1-bit solid mask and its sampling. The canvas-backed
 * mask builder (`alphaMaskOf`) needs a real 2d context and gracefully returns null without one — the
 * picker then keeps the box hit — so the load-bearing threshold + packing + bounds logic is what tests
 * here.
 */

/** An RGBA buffer of `width×height` with the given per-pixel alphas (row-major). */
function rgbaWithAlpha(width: number, height: number, alphas: readonly number[]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  alphas.forEach((a, i) => {
    rgba[i * 4 + 3] = a;
  });
  return rgba;
}

describe('buildAlphaMask / maskSolidAt', () => {
  it('marks a texel solid exactly when alpha >= SOLID_ALPHA_MIN', () => {
    const mask = buildAlphaMask(rgbaWithAlpha(2, 2, [0, SOLID_ALPHA_MIN - 1, SOLID_ALPHA_MIN, 255]), 2, 2);
    expect(maskSolidAt(mask, 0, 0)).toBe(false); // fully transparent
    expect(maskSolidAt(mask, 1, 0)).toBe(false); // soft shadow, below the threshold
    expect(maskSolidAt(mask, 0, 1)).toBe(true); // exactly at the threshold
    expect(maskSolidAt(mask, 1, 1)).toBe(true); // fully opaque
  });

  it('packs across byte boundaries (a 3×3 sheet spans two bytes)', () => {
    // Solid checkerboard: indices 0,2,4,6,8 — index 8 lives in the second packed byte.
    const alphas = [255, 0, 255, 0, 255, 0, 255, 0, 255];
    const mask = buildAlphaMask(rgbaWithAlpha(3, 3, alphas), 3, 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(maskSolidAt(mask, x, y)).toBe((y * 3 + x) % 2 === 0);
      }
    }
  });

  it('treats out-of-range coordinates as transparent', () => {
    const mask = buildAlphaMask(rgbaWithAlpha(2, 1, [255, 255]), 2, 1);
    expect(maskSolidAt(mask, -1, 0)).toBe(false);
    expect(maskSolidAt(mask, 2, 0)).toBe(false);
    expect(maskSolidAt(mask, 0, 1)).toBe(false);
  });
});
