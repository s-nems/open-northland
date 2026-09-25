import { describe, expect, it } from 'vitest';
import { readbackMatches } from '../src/view/browser-support.js';

const WRITTEN = new Uint8ClampedArray([0, 7, 128, 255, 254, 13, 29, 255]);

describe('readbackMatches', () => {
  it('accepts an exact read', () => {
    expect(readbackMatches(WRITTEN, WRITTEN.slice())).toBe(true);
  });

  it("tolerates Brave's default one-step shift of a colour channel", () => {
    expect(readbackMatches(WRITTEN, new Uint8ClampedArray([1, 6, 128, 255, 255, 13, 28, 255]))).toBe(true);
  });

  it('rejects replaced pixels, as strict fingerprinting protection returns', () => {
    expect(readbackMatches(WRITTEN, new Uint8ClampedArray([0, 7, 131, 255, 254, 13, 29, 255]))).toBe(false);
    expect(readbackMatches(WRITTEN, new Uint8ClampedArray(WRITTEN.length).fill(255))).toBe(false);
  });

  it('rejects a read of a different size', () => {
    expect(readbackMatches(WRITTEN, WRITTEN.slice(0, 4))).toBe(false);
  });
});
