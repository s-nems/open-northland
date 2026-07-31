import type { BrightnessField } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { footprintBrightness, unshadedLogicTypeIds } from '../src/content/object-shading.js';

/**
 * How a placed landscape object samples the map's baked `embr` lane: the tree full-bright exemption
 * resolved by name (unshadedLogicTypeIds) and the footprint-wide sample (footprintBrightness).
 */

describe('unshadedLogicTypeIds: the tree full-bright exemption resolves by NAME', () => {
  it('collects exactly the tree logic-type ids from the IR landscape table', () => {
    const ids = unshadedLogicTypeIds([
      { typeId: 1, name: 'void' },
      { typeId: 4, name: 'tree' },
      { typeId: 5, name: 'tree falling' },
      { typeId: 6, name: 'trunk' }, // a felled trunk lies ON the ground, shaded like stones
      { typeId: 15, name: 'stones' },
    ]);
    expect([...ids].sort((a, b) => a - b)).toEqual([4, 5]);
  });

  it('is empty for an absent/nameless table (every object then shades, the safe default)', () => {
    expect(unshadedLogicTypeIds(undefined).size).toBe(0);
    expect(unshadedLogicTypeIds([{ typeId: 4 }]).size).toBe(0);
  });
});

describe('footprintBrightness: a wide object grades against the ground it spans', () => {
  // One dark cell where the object is anchored (a bridge's bank), lit ground under the rest of it.
  const gorge: BrightnessField = {
    shaded: true,
    brightnessAt: (col, row) => (col === 5 && row === 2 ? 0.5 : 1.5),
  };
  const deck = [
    { dx: 0, dy: 0 },
    { dx: 2, dy: 0 },
    { dx: 4, dy: 0 },
  ];

  it('averages the lane over the footprint instead of sampling the node alone', () => {
    expect(footprintBrightness(gorge, 10, 4, deck)).toBeCloseTo((0.5 + 1.5 + 1.5) / 3);
  });

  it('falls back to the node cell when the record has no footprint (a flat decal)', () => {
    expect(footprintBrightness(gorge, 10, 4, [])).toBe(0.5);
  });

  it('reads a footprint offset as a half cell (the emla lattice: cell = node / 2)', () => {
    const ramp: BrightnessField = { shaded: true, brightnessAt: (col) => col };
    expect(footprintBrightness(ramp, 10, 4, [{ dx: 1, dy: 0 }])).toBe(5.5);
  });
});
