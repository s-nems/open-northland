import { describe, expect, it } from 'vitest';
import { walkPlacementAlpha } from '../../src/gpu/sprite-pool/walk-placement.js';

describe('walkPlacementAlpha - where an original walker stands inside a tick', () => {
  it('anchors the tick position for the whole tick', () => {
    for (const alpha of [0, 0.5, 0.99]) expect(walkPlacementAlpha(alpha, 'anchor')).toBe(1);
  });

  it('passes the frame fraction through for linear placement', () => {
    for (const alpha of [0, 0.25, 0.75]) expect(walkPlacementAlpha(alpha, 'linear')).toBe(alpha);
  });

  it('rests, then arrives with the frame change under window placement', () => {
    expect(walkPlacementAlpha(0, 'window')).toBe(0);
    expect(walkPlacementAlpha(0.6, 'window')).toBe(0);
    expect(walkPlacementAlpha(0.8, 'window')).toBeCloseTo(0.5);
    expect(walkPlacementAlpha(1, 'window')).toBe(1);
    let last = 0;
    for (let alpha = 0; alpha <= 1; alpha += 0.05) {
      const next = walkPlacementAlpha(alpha, 'window');
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });
});
