import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  ARMOR_MATERIAL,
  type CombatProfile,
  combatDamage,
  damageVsBuilding,
  damageVsWood,
  weaponDamageVsMaterial,
  weaponKey,
} from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';

/**
 * The combat damage read model — `combatDamage` selects the weapon's `damagevalue[material]` **column**
 * for each armor **material** a living target can wear (unarmored 0 + each `[armortype]` record's
 * `materialType`). The per-material value IS the resolved damage: armor works by COLUMN SELECTION, not
 * by subtracting a `blockingValue` (that uniform 5 has an unknown engine role — source basis — and
 * is NOT applied). The structure columns `WOOD` (6) / `HOUSE` (7) are NOT armor rows — they are the
 * vs-tree / vs-building views (`damageVsWood`/`damageVsBuilding`). These tests pin the column model, the
 * material union, the shared `weaponDamageVsMaterial` join, the composite `(tribeType, typeId)` key, and
 * that NO weapon record is dropped even when the key collides (the animal-weapon key reuse).
 */

const SWORD = 7; // a weapon with damage across materials 0..4 + the structure columns 6/7
const DAGGER = 8; // a weapon that lists only some materials — an absent column is 0 damage

function combatContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
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
        mainType: 3,
        // materials 0..4 (a living target) + 6 (vs wood) + 7 (vs building) — the full column set.
        damage: { '0': 100, '1': 80, '2': 60, '3': 40, '4': 20, '6': 30, '7': 55 },
      },
      {
        typeId: DAGGER,
        id: 'dagger',
        tribeType: 1,
        mainType: 3,
        // lists only materials 0/1/4 — the unlisted materials (2/3) resolve to 0 damage (no harm).
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
      // materialType == typeId for the four base armors — the column each selects.
      { typeId: 1, id: 'woolen_armor', goodType: 33, materialType: 1, blockingValue: 5 },
      { typeId: 2, id: 'leather_armor', goodType: 34, materialType: 2, blockingValue: 5 },
      { typeId: 3, id: 'chain_armor', goodType: 35, materialType: 3, blockingValue: 5 },
      { typeId: 4, id: 'plate_armor', goodType: 36, materialType: 4, blockingValue: 5 },
    ],
  });
}

// Find a profile by its weapon id (unique within this fixture except the deliberate animal pair).
function byId(profiles: readonly CombatProfile[], id: string): CombatProfile | undefined {
  return profiles.find((p) => p.id === id);
}

function damageAt(profile: CombatProfile | undefined, material: number): number | undefined {
  return profile?.rows.find((r) => r.material === material)?.damage;
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
    expect(damageAt(byId(profiles, 'chicken'), ARMOR_MATERIAL.NONE)).toBe(30);
    expect(damageAt(byId(profiles, 'claw'), ARMOR_MATERIAL.NONE)).toBe(60);
  });

  it('does not collapse weapons that share a typeId across tribes', () => {
    const profiles = combatDamage(combatContent());
    expect(damageAt(byId(profiles, 'sword'), ARMOR_MATERIAL.NONE)).toBe(100);
    expect(damageAt(byId(profiles, 'frank_sword'), ARMOR_MATERIAL.NONE)).toBe(200);
  });

  it('covers the unarmored material 0 and every armor material, sorted ascending', () => {
    const sword = byId(combatDamage(combatContent()), 'sword');
    // materials: 0 (unarmored) + 1..4 (the armor records' materialTypes). The structure columns 6/7
    // are NOT rows — they are damageVsWood/damageVsBuilding.
    expect(sword?.rows.map((r) => r.material)).toEqual([0, 1, 2, 3, 4]);
  });

  it('selects the per-material column verbatim — no blockingValue subtracted', () => {
    const sword = byId(combatDamage(combatContent()), 'sword');
    // Each row is the raw damagevalue for that material (100/80/60/40/20), NOT minus a blockingValue.
    expect(sword?.rows.map((r) => r.damage)).toEqual([100, 80, 60, 40, 20]);
    // Chain is material 3 → 40 (not 40 − 5); plate is material 4 → 20 (not 20 − 5).
    expect(damageAt(sword, ARMOR_MATERIAL.CHAIN)).toBe(40);
    expect(damageAt(sword, ARMOR_MATERIAL.PLATE)).toBe(20);
  });

  it('a material the weapon lists no value for does 0 damage (no harm), never negative', () => {
    const dagger = byId(combatDamage(combatContent()), 'dagger');
    // dagger lists materials 0/1/4; materials 2/3 are absent → 0 (the weapon does that armor no harm).
    expect(damageAt(dagger, ARMOR_MATERIAL.LEATHER)).toBe(0);
    expect(damageAt(dagger, ARMOR_MATERIAL.CHAIN)).toBe(0);
    // the listed materials land in full — no subtraction, so even the weak plate value (3) survives.
    expect(damageAt(dagger, ARMOR_MATERIAL.NONE)).toBe(10);
    expect(damageAt(dagger, ARMOR_MATERIAL.PLATE)).toBe(3);
  });

  it('exposes the structure columns as damageVsWood / damageVsBuilding, not as armor rows', () => {
    const content = combatContent();
    const sword = content.weapons.find((w) => w.id === 'sword');
    if (sword === undefined) throw new Error('sword missing');
    expect(damageVsWood(sword)).toBe(30); // material 6 column
    expect(damageVsBuilding(sword)).toBe(55); // material 7 column
    // and they are NOT living-target rows (the profile stops at material 4).
    const profile = byId(combatDamage(content), 'sword');
    expect(profile?.rows.some((r) => r.material === ARMOR_MATERIAL.WOOD)).toBe(false);
    expect(profile?.rows.some((r) => r.material === ARMOR_MATERIAL.HOUSE)).toBe(false);
    // a weapon that lists neither structure column reads 0 for both.
    const frankSword = content.weapons.find((w) => w.id === 'frank_sword');
    if (frankSword === undefined) throw new Error('frank_sword missing');
    expect(damageVsWood(frankSword)).toBe(0);
    expect(damageVsBuilding(frankSword)).toBe(0);
  });

  it('weaponDamageVsMaterial reads a single column — the shared join both the table and CombatSystem use', () => {
    const sword = combatContent().weapons.find((w) => w.id === 'sword');
    if (sword === undefined) throw new Error('sword missing');
    expect(weaponDamageVsMaterial(sword, ARMOR_MATERIAL.NONE)).toBe(100);
    expect(weaponDamageVsMaterial(sword, ARMOR_MATERIAL.PLATE)).toBe(20);
    expect(weaponDamageVsMaterial(sword, 99)).toBe(0); // an out-of-table material → 0, never a throw
  });

  it('still covers every armor material for a weapon that lists none of them', () => {
    // frank sword only lists material 0; materials 1..4 still appear as rows (damage 0).
    const rows = byId(combatDamage(combatContent()), 'frank_sword')?.rows ?? [];
    expect(rows.map((r) => r.material)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.find((r) => r.material === ARMOR_MATERIAL.LEATHER)).toEqual({ material: 2, damage: 0 });
  });

  it('is deterministic — identical content yields an identical table', () => {
    const a = combatDamage(combatContent());
    const b = combatDamage(combatContent());
    expect(a).toEqual(b);
  });

  it('with no armor records, resolves every weapon against the unarmored material only', () => {
    const noArmor = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [],
      weapons: [{ typeId: 1, id: 'fist', tribeType: 1, damage: { '0': 50, '2': 30 } }],
    });
    // no armor records → the only living-target material is the unarmored 0 (material 2 the weapon lists
    // is NOT invented as a row — with no leather armor record there is no leather column to fight).
    const rows = byId(combatDamage(noArmor), 'fist')?.rows ?? [];
    expect(rows.map((r) => r.material)).toEqual([ARMOR_MATERIAL.NONE]);
    expect(rows[0]).toEqual({ material: 0, damage: 50 });
  });

  it('is empty for content with no weapons', () => {
    const noWeapons = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [],
    });
    expect(combatDamage(noWeapons)).toEqual([]);
  });
});
