import { describe, expect, it } from 'vitest';
import { EquipClass } from '../src/schema/actors/equipment.js';

// The equip effect axis: optional integer-percent effect fields + rated uses on a good's EquipClass.
// Magnitudes are project balance (user rule 2026-07-24); the schema only enforces their shape.

describe('EquipClass', () => {
  it('accepts the full effect axis', () => {
    const parsed = EquipClass.parse({
      category: 'misc',
      wears: true,
      uses: 5,
      restorePct: { hunger: 50 },
    });
    expect(parsed.uses).toBe(5);
    expect(parsed.restorePct).toEqual({ hunger: 50 });
    expect(
      EquipClass.parse({ category: 'boots', wears: true, speedBonusPct: 40, uses: 6000 }).speedBonusPct,
    ).toBe(40);
    expect(
      EquipClass.parse({ category: 'tool', wears: true, productionBonusPct: 60, uses: 100 })
        .productionBonusPct,
    ).toBe(60);
  });

  it('keeps the bare classification valid (a permanent good carries no numbers)', () => {
    expect(EquipClass.parse({ category: 'weapon' })).toEqual({ category: 'weapon', wears: false });
  });

  it('rejects out-of-range or fractional percents and zero uses', () => {
    const bottle = { category: 'misc', wears: true, uses: 2 } as const; // a valid draught but for the percent
    expect(() => EquipClass.parse({ ...bottle, restorePct: { hunger: 0 } })).toThrow();
    expect(() => EquipClass.parse({ ...bottle, restorePct: { fatigue: 101 } })).toThrow();
    expect(() => EquipClass.parse({ ...bottle, restorePct: { healthMax: 50.5 } })).toThrow();
    expect(() => EquipClass.parse({ category: 'tool', uses: 0 })).toThrow();
    expect(() => EquipClass.parse({ category: 'boots', speedBonusPct: -40 })).toThrow();
  });

  it('rejects a wearing item without rated uses (it would never break)', () => {
    expect(() => EquipClass.parse({ category: 'boots', wears: true })).toThrow(/rate its uses/);
    expect(EquipClass.parse({ category: 'boots', wears: true, uses: 1 }).uses).toBe(1);
  });

  it('rejects a restoring item that never wears (a bottomless bottle)', () => {
    expect(() => EquipClass.parse({ category: 'misc', restorePct: { hunger: 50 } })).toThrow(/wear down/);
  });
});
