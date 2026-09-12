import { describe, expect, it } from 'vitest';
import { backingResolutionFor, windowResolutionFor } from '../src/gpu/pixi-app.js';

describe('backingResolutionFor', () => {
  it('keeps integer ratios as-is', () => {
    expect(backingResolutionFor(1)).toBe(1);
    expect(backingResolutionFor(2)).toBe(2);
    expect(backingResolutionFor(3)).toBe(3);
  });

  it('preserves fractional display density without a compositor downscale', () => {
    for (const dpr of [0.8, 1.25, 1.5, 1.75, 2.5, 2.0000004]) {
      expect(backingResolutionFor(dpr)).toBe(dpr);
      expect(windowResolutionFor(dpr, 1)).toBe(dpr);
    }
  });

  it('falls back to 1 for degenerate ratios', () => {
    expect(backingResolutionFor(0)).toBe(1);
    expect(backingResolutionFor(-2)).toBe(1);
    expect(backingResolutionFor(Number.NaN)).toBe(1);
    expect(backingResolutionFor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('windowResolutionFor', () => {
  it('multiplies the device density by the render scale', () => {
    expect(windowResolutionFor(1, 1)).toBe(1);
    expect(windowResolutionFor(1, 0.5)).toBe(0.5);
    expect(windowResolutionFor(2, 0.75)).toBe(1.5);
    expect(windowResolutionFor(1.5, 2)).toBe(3);
  });

  it('falls back to scale 1 for a degenerate scale', () => {
    expect(windowResolutionFor(2, 0)).toBe(2);
    expect(windowResolutionFor(2, -1)).toBe(2);
    expect(windowResolutionFor(2, Number.NaN)).toBe(2);
    expect(windowResolutionFor(2, Number.POSITIVE_INFINITY)).toBe(2);
  });
});
