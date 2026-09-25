import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../src/data/scene/index.js';
import {
  layerLutRow,
  type PlayerColourLut,
  paletteBlockRow,
  paletteLutRow,
  type SettlerCharacterSet,
  settlerPaletteLutRow,
  vehicleLutRow,
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

describe('paletteBlockRow', () => {
  it('reads a block the texture carries and the plain player row past the blocks', () => {
    const CART_BLOCK = 6;
    expect(paletteBlockRow(armorLut(7), 2, CART_BLOCK)).toBe(CART_BLOCK * 16 + 2);
    expect(paletteBlockRow(armorLut(5), 2, CART_BLOCK)).toBe(2); // a LUT built before the cart blocks
    expect(paletteBlockRow(armorLut(7), 2, undefined)).toBe(2);
  });
});

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

describe('vehicleLutRow', () => {
  const SHIP_PALETTES = 10;
  const lut = { source: {} as PlayerColourLut['source'], colours: SHIP_PALETTES };

  it("reads the owner's row, the first for an unowned vehicle, and wraps past the family", () => {
    expect(vehicleLutRow(lut, 3)).toBe(3);
    expect(vehicleLutRow(lut, undefined)).toBe(0);
    expect(vehicleLutRow(lut, SHIP_PALETTES + 2)).toBe(2);
  });
});
