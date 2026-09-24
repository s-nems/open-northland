import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  ARMOR_MATERIAL,
  armorMaterialForClass,
  armorMaterialForGood,
  weaponDamageVsMaterial,
  weaponKey,
} from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';

/**
 * The combat damage model: a weapon's `damagevalue` table is indexed by the victim's armor MATERIAL, and
 * the per-material value is the resolved damage. Armor works by column selection, not by subtracting its
 * `blockingValue` (that uniform 5 has an unknown engine role and is not applied).
 */

const SWORD = 7; // a weapon with damage across materials 0..4 + the structure columns 6/7
const DAGGER = 8; // a weapon that lists only some materials - an absent column is 0 damage
const WOOL_GOOD = 33;
const PLATE_GOOD = 36;
const UNCLAIMED_GOOD = 0;
const PLATE_CLASS = 4;
/** An armor class no `[armortype]` record describes. */
const UNRECORDED_CLASS = 9;
/** A material no weapon lists. */
const UNLISTED_MATERIAL = 99;

function combatContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: UNCLAIMED_GOOD, id: 'none' },
      { typeId: WOOL_GOOD, id: 'woolen', classification: { producedInHouse: true } },
      { typeId: PLATE_GOOD, id: 'plate', classification: { producedInHouse: true } },
    ],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [],
    weapons: [
      {
        typeId: SWORD,
        id: 'sword',
        tribeType: 1,
        mainType: 3,
        damage: { '0': 100, '1': 80, '2': 60, '3': 40, '4': 20, '6': 30, '7': 55 },
      },
      { typeId: DAGGER, id: 'dagger', tribeType: 1, mainType: 3, damage: { '0': 10, '1': 7, '4': 3 } },
    ],
    armor: [
      { typeId: 1, id: 'woolen_armor', goodType: WOOL_GOOD, materialType: 1, blockingValue: 5 },
      { typeId: PLATE_CLASS, id: 'plate_armor', goodType: PLATE_GOOD, materialType: 4, blockingValue: 5 },
    ],
  });
}

function weapon(id: string): ContentSet['weapons'][number] {
  const found = combatContent().weapons.find((w) => w.id === id);
  if (found === undefined) throw new Error(`${id} missing`);
  return found;
}

describe('weaponDamageVsMaterial', () => {
  it('selects the material column verbatim - no blockingValue subtracted', () => {
    const sword = weapon('sword');
    expect(weaponDamageVsMaterial(sword, ARMOR_MATERIAL.NONE)).toBe(100);
    expect(weaponDamageVsMaterial(sword, ARMOR_MATERIAL.CHAIN)).toBe(40);
    expect(weaponDamageVsMaterial(sword, ARMOR_MATERIAL.PLATE)).toBe(20);
  });

  it('reads the structure columns through the same join', () => {
    const sword = weapon('sword');
    expect(weaponDamageVsMaterial(sword, ARMOR_MATERIAL.WOOD)).toBe(30);
    expect(weaponDamageVsMaterial(sword, ARMOR_MATERIAL.HOUSE)).toBe(55);
  });

  it('does 0 damage against a material the weapon lists no value for, never a throw', () => {
    const dagger = weapon('dagger');
    expect(weaponDamageVsMaterial(dagger, ARMOR_MATERIAL.LEATHER)).toBe(0);
    expect(weaponDamageVsMaterial(dagger, ARMOR_MATERIAL.HOUSE)).toBe(0);
    expect(weaponDamageVsMaterial(dagger, UNLISTED_MATERIAL)).toBe(0);
    // A listed weak column still lands in full.
    expect(weaponDamageVsMaterial(dagger, ARMOR_MATERIAL.PLATE)).toBe(3);
  });
});

describe('armor material resolution', () => {
  it('resolves a worn class and a worn good to the record material column', () => {
    const content = combatContent();
    expect(armorMaterialForClass(content, PLATE_CLASS)).toBe(ARMOR_MATERIAL.PLATE);
    expect(armorMaterialForGood(content, WOOL_GOOD)).toBe(ARMOR_MATERIAL.WOOL);
  });

  it('keeps an unrecorded class as its own column and claims no material for an armorless good', () => {
    const content = combatContent();
    expect(armorMaterialForClass(content, UNRECORDED_CLASS)).toBe(UNRECORDED_CLASS);
    expect(armorMaterialForGood(content, UNCLAIMED_GOOD)).toBeNull();
  });
});

describe('weaponKey', () => {
  it('keys on (tribeType, typeId), the tribe-less slot left empty', () => {
    expect(weaponKey({ tribeType: 1, typeId: SWORD })).toBe('1:7');
    expect(weaponKey({ tribeType: 2, typeId: SWORD })).not.toBe(weaponKey({ tribeType: 1, typeId: SWORD }));
    expect(weaponKey({ tribeType: undefined, typeId: SWORD })).toBe(':7');
  });
});
