import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { type CombatProfile, combatDamage, weaponKey } from '../src/systems/index.js';

/**
 * The combat damage read model — `combatDamage` joins each `WeaponType.damage` (the per-armor-class
 * raw damage the original `weapontypes` pre-tabulates) against each `ArmorType.blockingValue`,
 * resolving the NET damage a weapon lands on a target: `max(0, rawDamage - blockingValue)`. It is the
 * read half of the CombatSystem, the content-only analogue of `goodsGraph`: a pure, deterministic
 * lookup, no mechanic. These tests pin the join — the unarmored class 0, the armored classes 1..4, the
 * clamp at 0, the KNOWN GAP (an out-of-table class 6/7 with no armor record treated as unarmored), the
 * composite `(tribeType, typeId)` weapon key, and that NO weapon record is dropped even when the key
 * collides (the animal-weapon key reuse).
 */

const SWORD = 7; // a weapon with damage across classes 0..4 + the out-of-table class 6
const DAGGER = 8; // a weak weapon — armor fully absorbs some classes (net clamps to 0)

function combatContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: 33, id: 'woolen', classification: { producedInHouse: true } },
      { typeId: 34, id: 'leather', classification: { producedInHouse: true } },
      { typeId: 35, id: 'chain', classification: { producedInHouse: true } },
      { typeId: 36, id: 'plate', classification: { producedInHouse: true } },
    ],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [],
    weapons: [
      {
        typeId: SWORD,
        id: 'sword',
        tribeType: 1,
        // class 6 has NO armortype record — the out-of-table tier the real data references.
        damage: { '0': 100, '1': 80, '2': 60, '3': 40, '4': 20, '6': 30 },
      },
      {
        typeId: DAGGER,
        id: 'dagger',
        tribeType: 1,
        // weak: against the heavier classes the blockingValue (5) exceeds the raw, so net clamps to 0.
        damage: { '0': 10, '1': 7, '4': 3 },
      },
      // The SAME typeId as the sword, but a DIFFERENT tribe — must NOT collide.
      {
        typeId: SWORD,
        id: 'frank_sword',
        tribeType: 2,
        damage: { '0': 200 },
      },
      // Two weapons sharing the SAME (tribeType, typeId) — the real animal-weapon quirk (tribe 5 has
      // chicken+claw at typeId 1). A Map key would drop one; the array must keep BOTH.
      { typeId: 1, id: 'chicken', tribeType: 5, damage: { '0': 30 } },
      { typeId: 1, id: 'claw', tribeType: 5, damage: { '0': 60 } },
    ],
    armor: [
      { typeId: 1, id: 'woolen_armor', goodType: 33, blockingValue: 5 },
      { typeId: 2, id: 'leather_armor', goodType: 34, blockingValue: 5 },
      { typeId: 3, id: 'chain_armor', goodType: 35, blockingValue: 5 },
      { typeId: 4, id: 'plate_armor', goodType: 36, blockingValue: 5 },
    ],
  });
}

// Find a profile by its weapon id (unique within this fixture except the deliberate animal pair).
function byId(profiles: readonly CombatProfile[], id: string): CombatProfile | undefined {
  return profiles.find((p) => p.id === id);
}

describe('combatDamage', () => {
  it('has one profile per weapon, in source array order', () => {
    const profiles = combatDamage(combatContent());
    expect(profiles.map((p) => p.id)).toEqual(['sword', 'dagger', 'frank_sword', 'chicken', 'claw']);
  });

  it('carries the composite (tribeType, typeId) key on each profile', () => {
    const sword = byId(combatDamage(combatContent()), 'sword');
    expect(sword?.key).toBe(weaponKey({ tribeType: 1, typeId: SWORD }));
    expect(sword?.tribeType).toBe(1);
    expect(sword?.typeId).toBe(SWORD);
  });

  it('keeps BOTH weapons that share a (tribeType, typeId) — no record dropped', () => {
    const profiles = combatDamage(combatContent());
    const sameKey = profiles.filter((p) => p.key === weaponKey({ tribeType: 5, typeId: 1 }));
    expect(sameKey.map((p) => p.id)).toEqual(['chicken', 'claw']); // both present, not collapsed
    expect(byId(profiles, 'chicken')?.rows.find((r) => r.armorClass === 0)?.rawDamage).toBe(30);
    expect(byId(profiles, 'claw')?.rows.find((r) => r.armorClass === 0)?.rawDamage).toBe(60);
  });

  it('does not collapse weapons that share a typeId across tribes', () => {
    const profiles = combatDamage(combatContent());
    expect(byId(profiles, 'sword')?.rows.find((r) => r.armorClass === 0)?.rawDamage).toBe(100);
    expect(byId(profiles, 'frank_sword')?.rows.find((r) => r.armorClass === 0)?.rawDamage).toBe(200);
  });

  it('covers the unarmored class 0 and every armored class, sorted ascending', () => {
    const sword = byId(combatDamage(combatContent()), 'sword');
    // classes: 0 (unarmored) + 1..4 (armor records) + 6 (out-of-table, from the weapon's own damage).
    expect(sword?.rows.map((r) => r.armorClass)).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it('class 0 is unarmored — no record, no mitigation, net == raw', () => {
    const row = byId(combatDamage(combatContent()), 'sword')?.rows.find((r) => r.armorClass === 0);
    expect(row).toEqual({
      armorClass: 0,
      rawDamage: 100,
      blockingValue: 0,
      netDamage: 100,
      hasArmorRecord: false,
    });
  });

  it('subtracts the armor blockingValue for an armored class', () => {
    const row = byId(combatDamage(combatContent()), 'sword')?.rows.find((r) => r.armorClass === 3);
    expect(row).toEqual({
      armorClass: 3,
      rawDamage: 40,
      blockingValue: 5,
      netDamage: 35, // 40 - 5
      hasArmorRecord: true,
    });
  });

  it('treats an out-of-table class (6/7, no armortype record) as unarmored, not a crash', () => {
    const row = byId(combatDamage(combatContent()), 'sword')?.rows.find((r) => r.armorClass === 6);
    expect(row).toEqual({
      armorClass: 6,
      rawDamage: 30,
      blockingValue: 0, // no record -> no mitigation
      netDamage: 30,
      hasArmorRecord: false,
    });
  });

  it('clamps net damage at 0 — armor never heals the target', () => {
    const rows = byId(combatDamage(combatContent()), 'dagger')?.rows ?? [];
    // dagger lists no value for classes 2/3 -> rawDamage 0 -> net 0 (no harm).
    const c2 = rows.find((r) => r.armorClass === 2);
    expect(c2).toEqual({ armorClass: 2, rawDamage: 0, blockingValue: 5, netDamage: 0, hasArmorRecord: true });
    // class 4: raw 3 < blocking 5 -> net clamps to 0, never negative.
    const c4 = rows.find((r) => r.armorClass === 4);
    expect(c4?.netDamage).toBe(0);
    // class 0 (unarmored): raw 10 lands in full.
    expect(rows.find((r) => r.armorClass === 0)?.netDamage).toBe(10);
  });

  it('still covers every armor class for a weapon that lists none of them', () => {
    // frank sword only lists class 0; the armor classes 1..4 still appear (rawDamage 0 -> net 0).
    const rows = byId(combatDamage(combatContent()), 'frank_sword')?.rows ?? [];
    expect(rows.map((r) => r.armorClass)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.find((r) => r.armorClass === 2)).toEqual({
      armorClass: 2,
      rawDamage: 0,
      blockingValue: 5,
      netDamage: 0,
      hasArmorRecord: true,
    });
  });

  it('is deterministic — identical content yields an identical table', () => {
    const a = combatDamage(combatContent());
    const b = combatDamage(combatContent());
    expect(a).toEqual(b);
  });

  it('with no armor records, still resolves every weapon against the unarmored class', () => {
    const noArmor = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [],
      weapons: [{ typeId: 1, id: 'fist', tribeType: 1, damage: { '0': 50, '2': 30 } }],
    });
    const rows = byId(combatDamage(noArmor), 'fist')?.rows ?? [];
    // class 0 (always) + class 2 (from the weapon's own damage, no record -> unarmored).
    expect(rows.map((r) => r.armorClass)).toEqual([0, 2]);
    expect(rows.every((r) => !r.hasArmorRecord && r.blockingValue === 0)).toBe(true);
  });

  it('is empty for content with no weapons', () => {
    const noWeapons = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [],
    });
    expect(combatDamage(noWeapons)).toEqual([]);
  });
});
