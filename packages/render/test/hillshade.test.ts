import { describe, expect, it } from 'vitest';
import { BRIGHTNESS_NEUTRAL } from '../src/data/brightness.js';
import { composeShadingLane } from '../src/data/hillshade.js';

/** A 3×3 ramp rising left → right: its surface faces west (the normal tilts −x, toward the NW
 *  light), so it shades brighter than flat; the gradient is purely +x, so rows are identical. */
const RAMP_3X3 = [0, 8, 16, 0, 8, 16, 0, 8, 16];

describe('composeShadingLane', () => {
  it('returns the brightness lane unchanged when there is no elevation', () => {
    const embr = [100, 127, 200, 0];
    expect(composeShadingLane(embr, undefined, 2, 2)).toBe(embr);
    expect(composeShadingLane(undefined, undefined, 2, 2)).toBeUndefined();
  });

  it('returns the brightness lane unchanged on a flat map (no relief to shade)', () => {
    const embr = [100, 127, 200, 130];
    const flat = [5, 5, 5, 5];
    expect(composeShadingLane(embr, flat, 2, 2)).toBe(embr);
    expect(composeShadingLane(undefined, flat, 2, 2)).toBeUndefined();
  });

  it('replaces an absent brightness lane with neutral-centred hillshade', () => {
    const lane = composeShadingLane(undefined, RAMP_3X3, 3, 3);
    expect(lane).toBeDefined();
    // The ramp faces the NW light, so it shades brighter than neutral; every row is identical
    // (the gradient is purely +x).
    const centre = lane?.[4] ?? 0;
    expect(centre).toBeGreaterThan(BRIGHTNESS_NEUTRAL);
    expect(centre).toBeLessThanOrEqual(255);
    expect(lane?.[1]).toBe(centre);
    expect(lane?.[7]).toBe(centre);
  });

  it('darkens slopes facing away from the light on a fallback map', () => {
    // Mirror ramp (rises right → left): its surface faces east, away from the NW light.
    const mirrored = [16, 8, 0, 16, 8, 0, 16, 8, 0];
    const lane = composeShadingLane(undefined, mirrored, 3, 3);
    const centre = lane?.[4] ?? 0;
    expect(centre).toBeLessThan(BRIGHTNESS_NEUTRAL);
    expect(centre).toBeGreaterThan(0);
  });

  it('only accents an existing brightness lane (bounded fraction of the full hillshade)', () => {
    const embr = new Array<number>(9).fill(BRIGHTNESS_NEUTRAL);
    const mirrored = [16, 8, 0, 16, 8, 0, 16, 8, 0]; // shadowed slope — deltas below neutral
    const accented = composeShadingLane(embr, mirrored, 3, 3);
    const full = composeShadingLane(undefined, mirrored, 3, 3);
    const accentDelta = BRIGHTNESS_NEUTRAL - (accented?.[4] ?? 0);
    const fullDelta = BRIGHTNESS_NEUTRAL - (full?.[4] ?? 0);
    expect(accentDelta).toBeGreaterThan(0);
    expect(accentDelta).toBeLessThan(fullDelta);
  });

  it('clamps the composed lane into the byte range', () => {
    const embr = new Array<number>(9).fill(250);
    const mirrored = [64, 32, 0, 64, 32, 0, 64, 32, 0]; // steep lit slope on a near-white bake
    const lane = composeShadingLane(embr, mirrored, 3, 3);
    for (const v of lane ?? []) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
