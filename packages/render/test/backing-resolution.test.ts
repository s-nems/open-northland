import { describe, expect, it } from 'vitest';
import { backingResolutionFor } from '../src/gpu/pixi-app.js';

describe('backingResolutionFor', () => {
  it('keeps integer ratios as-is', () => {
    expect(backingResolutionFor(1)).toBe(1);
    expect(backingResolutionFor(2)).toBe(2);
    expect(backingResolutionFor(3)).toBe(3);
  });

  it('rounds fractional OS scaling up to the next integer', () => {
    expect(backingResolutionFor(1.25)).toBe(2);
    expect(backingResolutionFor(1.5)).toBe(2);
    expect(backingResolutionFor(1.75)).toBe(2);
    expect(backingResolutionFor(2.5)).toBe(3);
  });

  it('absorbs float noise around integer ratios instead of jumping a tier', () => {
    expect(backingResolutionFor(2.0000004)).toBe(2);
    expect(backingResolutionFor(1.9999996)).toBe(2);
  });

  it('falls back to 1 for degenerate ratios', () => {
    expect(backingResolutionFor(0)).toBe(1);
    expect(backingResolutionFor(-2)).toBe(1);
    expect(backingResolutionFor(Number.NaN)).toBe(1);
    expect(backingResolutionFor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
