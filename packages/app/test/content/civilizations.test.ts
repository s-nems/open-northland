import { describe, expect, it } from 'vitest';
import { civilizationRows, civilizationTribes, modCivilizations } from '../../src/content/civilizations.js';

/**
 * The content's civilization list: the authored five are the floor, and a pack's flagged `tribes` row
 * joins it (`docs/MODS.md`, "New civilizations"). The original ids above the monsters name animal
 * species, which the wildlife join owns, so an unflagged or in-range row never counts.
 */

const AUTHORED = [1, 2, 3, 4, 7];

const row = (typeId: number, over: { name?: string; civilization?: boolean } = {}) => ({
  typeId,
  ...over,
});

describe('modCivilizations', () => {
  it('is empty without content', () => {
    expect(modCivilizations(undefined)).toEqual([]);
    expect(modCivilizations([])).toEqual([]);
  });

  it('reads the flagged tribes rows above the authored ids, in id order', () => {
    const tribes = [
      row(7, { civilization: true }),
      row(42, { civilization: true, name: 'Northmen' }),
      row(43),
    ];
    expect(modCivilizations(tribes)).toEqual([{ typeId: 42, name: 'Northmen' }]);
  });

  it('never counts the authored ids, flagged or not', () => {
    const tribes = [row(1, { civilization: true }), row(7, { civilization: true, name: 'egypt' })];
    expect(modCivilizations(tribes)).toEqual([]);
  });

  it('keeps the first row of a repeated id', () => {
    const tribes = [
      row(42, { civilization: true, name: 'first' }),
      row(42, { civilization: true, name: 'second' }),
    ];
    expect(modCivilizations(tribes)).toEqual([{ typeId: 42, name: 'first' }]);
  });
});

describe('civilizationTribes', () => {
  it('is the authored five without content', () => {
    expect(civilizationTribes(undefined)).toEqual(AUTHORED);
  });

  it("appends the content's people behind the authored five", () => {
    expect(civilizationTribes([row(43, { civilization: true }), row(42, { civilization: true })])).toEqual([
      ...AUTHORED,
      42,
      43,
    ]);
  });
});

describe('civilizationRows', () => {
  it('names the authored five from the content rows where it has one', () => {
    const rows = civilizationRows([
      row(2, { name: 'frank' }),
      row(42, { civilization: true, name: 'Northmen' }),
    ]);
    expect(rows).toEqual([
      { typeId: 1 },
      { typeId: 2, name: 'frank' },
      { typeId: 3 },
      { typeId: 4 },
      { typeId: 7 },
      { typeId: 42, name: 'Northmen' },
    ]);
  });
});
