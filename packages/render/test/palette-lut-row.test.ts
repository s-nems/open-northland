import { describe, expect, it } from 'vitest';
import { type PlayerColourLut, paletteLutRow } from '../src/gpu/sprite-sheet.js';

/** An 80-row LUT with the armor axis: 16 players x 5 tiers, chain armor = good 35 -> tier 3. */
function armorLut(colours: number): PlayerColourLut {
  return {
    source: {} as PlayerColourLut['source'], // the row math never touches the texture
    colours,
    playerRows: 16,
    armorTierByGood: new Map([[35, 3]]),
  };
}

describe('paletteLutRow', () => {
  it('selects row tier*playerRows + player for a mapped worn armor good', () => {
    expect(paletteLutRow(armorLut(80), 2, 35)).toBe(3 * 16 + 2);
  });

  it('falls back to the plain player row without worn armor or for an unmapped good', () => {
    expect(paletteLutRow(armorLut(80), 2, null)).toBe(2); // empty armor slot
    expect(paletteLutRow(armorLut(80), 2, undefined)).toBe(2); // no Equipment at all
    expect(paletteLutRow(armorLut(80), 2, 99)).toBe(2); // good with no armor record
  });

  it('falls back to the plain player row when the tier row lies past the texture', () => {
    expect(paletteLutRow(armorLut(16), 2, 35)).toBe(2); // row 50 >= 16 colours - out of texture
  });

  it('reads an unowned settler as the base palette row of its block', () => {
    expect(paletteLutRow(armorLut(80), undefined, 35)).toBe(3 * 16);
  });
});
