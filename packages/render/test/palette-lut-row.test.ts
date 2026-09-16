import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../src/data/scene/index.js';
import {
  layerLutRow,
  type PlayerColourLut,
  paletteLutRow,
  type SettlerCharacterSet,
  settlerPaletteLutRow,
} from '../src/gpu/sprite-sheet.js';

/** A LUT of `blocks` 16-player blocks plus the head row (81 rows for the five armor tiers); chain
 *  armor = good 35 -> tier 3. */
function armorLut(blocks: number): PlayerColourLut {
  const headRow = blocks * 16;
  return {
    source: {} as PlayerColourLut['source'], // the row math never touches the texture
    colours: headRow + 1,
    playerRows: 16,
    armorTierByGood: new Map([[35, 3]]),
    headRow,
  };
}

describe('paletteLutRow', () => {
  it('selects row tier*playerRows + player for a mapped worn armor good', () => {
    expect(paletteLutRow(armorLut(5), 2, 35)).toBe(3 * 16 + 2);
  });

  it('falls back to the plain player row without worn armor or for an unmapped good', () => {
    expect(paletteLutRow(armorLut(5), 2, null)).toBe(2); // empty armor slot
    expect(paletteLutRow(armorLut(5), 2, undefined)).toBe(2); // no Equipment at all
    expect(paletteLutRow(armorLut(5), 2, 99)).toBe(2); // good with no armor record
  });

  it('falls back to the plain player row when the tier row lies past the blocks', () => {
    // The degraded 17-row LUT (unreadable armor recipes): row 50 is past its one block.
    expect(paletteLutRow(armorLut(1), 2, 35)).toBe(2);
    // Tier 1 of player 0 would land exactly on the head row, which is no team row.
    const wool = { ...armorLut(1), armorTierByGood: new Map([[33, 1]]) };
    expect(paletteLutRow(wool, 0, 33)).toBe(0);
  });

  it('reads an unowned settler as the base palette row of its block', () => {
    expect(paletteLutRow(armorLut(5), undefined, 35)).toBe(3 * 16);
  });
});

describe('settlerPaletteLutRow', () => {
  const item: DrawItem = {
    kind: 'settler',
    ref: 1,
    x: 0,
    y: 0,
    depth: 0,
    player: 2,
    jobType: 43,
    armorGood: 35,
  };
  const characters = {
    byJob: {},
    fixedByJob: { 43: {} },
    default: {},
  } as unknown as SettlerCharacterSet;

  it('keeps a fixed hero character on its base player row despite its mechanical armor', () => {
    expect(settlerPaletteLutRow({ palette: armorLut(5), characters }, item)).toBe(2);
  });

  it('still applies the armor tier to an ordinary settler character', () => {
    expect(settlerPaletteLutRow({ palette: armorLut(5) }, item)).toBe(3 * 16 + 2);
  });
});

describe('layerLutRow', () => {
  it('sends a head overlay to the head row and every other layer to the body row', () => {
    const lut = armorLut(5);
    expect(layerLutRow(lut, { head: true }, 3 * 16 + 2)).toBe(lut.headRow);
    expect(layerLutRow(lut, {}, 3 * 16 + 2)).toBe(3 * 16 + 2);
  });
});
