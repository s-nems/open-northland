import { type ContentSet, IR_VERSION, type WeaponType, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import {
  isRangedWeapon,
  isSiegeWeapon,
  rangedWeapons,
  siegeWeapons,
  weaponClassOf,
  weaponsByClass,
} from '../src/systems/index.js';

/** Resolve a weapon by its `id` from a content set (throws if absent — a test-fixture programmer error). */
function weapon(content: ContentSet, id: string): WeaponType {
  const found = content.weapons.find((w) => w.id === id);
  if (found === undefined) throw new Error(`fixture has no weapon "${id}"`);
  return found;
}

/**
 * The weapon-classification read views — `isRangedWeapon`/`rangedWeapons` (the bow/catapult rows that
 * fire ammunition) and `isSiegeWeapon`/`siegeWeapons` (the catapult rows that deal area damage) classify
 * `content.weapons` *by the data alone* off the extracted `munitiontype`/`damagetype` markers, the
 * weapon-side twins of `isShipVehicle`/`shipVehicles`. The data-defined seed the deferred ranged-attack /
 * siege-resolution drives switch on — never a hardcoded weapon name. A pure read over content; no world,
 * no mechanic added.
 *
 * The fixture mirrors the real `weapons.ini` shape: melee rows leave `munitionType`/`damageType`
 * `undefined` (a fist `mainType 1`, a spear `mainType 2`, a sword `mainType 3` — no ammo, no siege
 * class); a `bow_short` carries `munitiontype 1` (bow ammo) but NO `damagetype` (ranged, not siege); and
 * a `catapult` carries both `munitiontype 2` (projectile) AND `damagetype 2` (the siege/AoE class) — so
 * it is both ranged and siege, the strict-subset case. Rows are declared OUT of source order to prove the
 * views keep `content.weapons` order rather than re-sorting.
 */
function weaponContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    weapons: [
      // A melee fist: no munitionType (not ranged), no damageType (not siege).
      { typeId: 1, id: 'fist', tribeType: 1, mainType: 1 },
      // A catapult declared BEFORE the bow — both ranged; the catapult is the only siege row.
      { typeId: 7, id: 'catapult', tribeType: 1, mainType: 7, munitionType: 2, damageType: 2 },
      // A short bow: munitionType 1 (fires arrows) but NO damageType — ranged, not siege.
      { typeId: 6, id: 'bow_short', tribeType: 1, mainType: 6, munitionType: 1 },
      // A melee spear and sword: neither ranged nor siege.
      { typeId: 4, id: 'wooden_spear', tribeType: 1, mainType: 2 },
      { typeId: 5, id: 'sword_short', tribeType: 1, mainType: 3 },
    ],
  });
}

describe('isRangedWeapon', () => {
  it('is true for a weapon that fires ammunition (bow / catapult) and false for melee', () => {
    const content = weaponContent();
    expect(isRangedWeapon(weapon(content, 'bow_short'))).toBe(true);
    expect(isRangedWeapon(weapon(content, 'catapult'))).toBe(true);
    expect(isRangedWeapon(weapon(content, 'fist'))).toBe(false); // no munitionType — melee
    expect(isRangedWeapon(weapon(content, 'wooden_spear'))).toBe(false);
    expect(isRangedWeapon(weapon(content, 'sword_short'))).toBe(false);
  });
});

describe('isSiegeWeapon', () => {
  it('is true only for the catapult (the row carrying a damageType)', () => {
    const content = weaponContent();
    expect(isSiegeWeapon(weapon(content, 'catapult'))).toBe(true);
    expect(isSiegeWeapon(weapon(content, 'bow_short'))).toBe(false); // ranged but NOT siege
    expect(isSiegeWeapon(weapon(content, 'fist'))).toBe(false);
    expect(isSiegeWeapon(weapon(content, 'wooden_spear'))).toBe(false);
  });

  it('is a strict subset of ranged: every siege weapon is also ranged', () => {
    const content = weaponContent();
    for (const w of siegeWeapons(content)) expect(isRangedWeapon(w)).toBe(true);
  });
});

describe('rangedWeapons', () => {
  it('returns only the ammunition-firing weapons (bow + catapult), in source order', () => {
    // Declared order is fist, catapult, bow_short, spear, sword — so the ranged subset keeps
    // catapult before bow_short (source order, not re-sorted by typeId).
    const ids = rangedWeapons(weaponContent()).map((w) => w.id);
    expect(ids).toEqual(['catapult', 'bow_short']);
  });

  it('is empty when no weapon fires ammunition (a melee-only set)', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      weapons: [{ typeId: 1, id: 'fist', tribeType: 1, mainType: 1 }],
    });
    expect(rangedWeapons(content)).toEqual([]);
  });

  it('is empty for content with no weapons at all (parseContentSet defaults weapons to [])', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    });
    expect(rangedWeapons(content)).toEqual([]);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = weaponContent();
    expect(rangedWeapons(content)).toEqual(rangedWeapons(content));
  });
});

describe('siegeWeapons', () => {
  it('returns only the area-damage weapons (the catapult)', () => {
    const ids = siegeWeapons(weaponContent()).map((w) => w.id);
    expect(ids).toEqual(['catapult']);
  });

  it('is empty when no weapon carries a damageType (a ranged-but-no-siege set)', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      // a bow is ranged but not siege — the view excludes it
      weapons: [{ typeId: 6, id: 'bow_short', tribeType: 1, mainType: 6, munitionType: 1 }],
    });
    expect(siegeWeapons(content)).toEqual([]);
  });
});

describe('weaponClassOf', () => {
  it('returns the weapon coarse class (its mainType) for each weapon', () => {
    const content = weaponContent();
    expect(weaponClassOf(weapon(content, 'fist'))).toBe(1);
    expect(weaponClassOf(weapon(content, 'wooden_spear'))).toBe(2);
    expect(weaponClassOf(weapon(content, 'sword_short'))).toBe(3);
    expect(weaponClassOf(weapon(content, 'bow_short'))).toBe(6);
    expect(weaponClassOf(weapon(content, 'catapult'))).toBe(7);
  });

  it('is undefined for a malformed weapon carrying no mainType', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      weapons: [{ typeId: 1, id: 'no_class', tribeType: 1 }],
    });
    expect(weaponClassOf(weapon(content, 'no_class'))).toBeUndefined();
  });
});

describe('weaponsByClass', () => {
  it('partitions the weapons by their coarse class, each bucket in source order', () => {
    const byClass = weaponsByClass(weaponContent());
    // 5 distinct classes among the 5 fixture weapons: fist=1, spear=2, sword=3, bow=6, catapult=7.
    expect([...byClass.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 6, 7]);
    expect(byClass.get(1)?.map((w) => w.id)).toEqual(['fist']);
    expect(byClass.get(6)?.map((w) => w.id)).toEqual(['bow_short']);
    expect(byClass.get(7)?.map((w) => w.id)).toEqual(['catapult']);
  });

  it('groups multiple weapons sharing a class into one bucket, preserving source order', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      // two class-3 swords (declared sword_a before sword_b) plus a class-1 fist between them
      weapons: [
        { typeId: 5, id: 'sword_a', tribeType: 1, mainType: 3 },
        { typeId: 1, id: 'fist', tribeType: 1, mainType: 1 },
        { typeId: 6, id: 'sword_b', tribeType: 1, mainType: 3 },
      ],
    });
    const byClass = weaponsByClass(content);
    // both swords land in bucket 3, sword_a before sword_b (content.weapons order, not declaration of the bucket)
    expect(byClass.get(3)?.map((w) => w.id)).toEqual(['sword_a', 'sword_b']);
    expect(byClass.get(1)?.map((w) => w.id)).toEqual(['fist']);
  });

  it('omits a weapon with no mainType (no undefined bucket)', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      weapons: [
        { typeId: 5, id: 'sword', tribeType: 1, mainType: 3 },
        { typeId: 1, id: 'no_class', tribeType: 1 }, // no mainType — dropped, not bucketed under undefined
      ],
    });
    const byClass = weaponsByClass(content);
    expect([...byClass.keys()]).toEqual([3]);
    expect(byClass.get(3)?.map((w) => w.id)).toEqual(['sword']);
  });

  it('is empty for content with no weapons (parseContentSet defaults weapons to [])', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    });
    expect(weaponsByClass(content).size).toBe(0);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = weaponContent();
    expect(weaponsByClass(content)).toEqual(weaponsByClass(content));
  });
});
