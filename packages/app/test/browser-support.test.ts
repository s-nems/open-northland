import { describe, expect, it } from 'vitest';
import { compareReadback } from '../src/view/browser-support.js';

const WRITTEN = new Uint8ClampedArray([0, 7, 128, 255, 254, 13, 29, 255]);

describe('compareReadback', () => {
  it('reports an unchanged read as exact', () => {
    expect(compareReadback(WRITTEN, WRITTEN.slice())).toBe('exact');
  });

  it("reports Brave's one-step shift of a colour channel as shifted", () => {
    expect(compareReadback(WRITTEN, new Uint8ClampedArray([1, 6, 128, 255, 255, 13, 28, 255]))).toBe(
      'shifted',
    );
  });

  it('reports pixels strict fingerprinting protection returns as replaced', () => {
    expect(compareReadback(WRITTEN, new Uint8ClampedArray([0, 7, 131, 255, 254, 13, 29, 255]))).toBe(
      'replaced',
    );
    expect(compareReadback(WRITTEN, new Uint8ClampedArray(WRITTEN.length).fill(255))).toBe('replaced');
  });

  it('reports a read of a different size as replaced', () => {
    expect(compareReadback(WRITTEN, WRITTEN.slice(0, 4))).toBe('replaced');
  });
});
