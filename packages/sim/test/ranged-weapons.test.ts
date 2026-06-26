import { type ContentSet, IR_VERSION, type WeaponType, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import {
  isRangedWeapon,
  isSiegeWeapon,
  rangedWeapons,
  siegeWeapons,
  weaponClassOf,
  weaponsByClass,
  weaponsByJob,
  weaponsForJob,
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

/**
 * A fixture for the soldier-class→weapon roster views, mirroring the real `weapons.ini` shape: every
 * `[weapontype]` names the `jobtype` that wields it (the swordsman job 6, the fist-fighter job 31), and a
 * job wields several weapons across the tribes (job 6 wields a sword AND a mace here, the many-to-one
 * join). The `jobType` is a CROSS-REFERENCE into the jobs table, so each referenced job is declared in
 * `jobs` (else `parseContentSet` rejects the content). One row leaves `jobType` unset to prove it is
 * dropped (no `undefined` bucket), the same drop-undefined stance `weaponsByClass` takes for `mainType`.
 * Rows are declared OUT of source order within a job to prove the buckets keep `content.weapons` order.
 */
function jobWeaponContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 6, id: 'swordsman' },
      { typeId: 31, id: 'fighter' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    weapons: [
      // swordsman (job 6) wields a sword; a fist (job 31) declared between its two weapons
      { typeId: 5, id: 'sword_short', tribeType: 1, mainType: 3, jobType: 6 },
      { typeId: 1, id: 'fist', tribeType: 1, mainType: 1, jobType: 31 },
      // a second swordsman weapon (a mace) — same job 6, declared AFTER the fist (the many-to-one join)
      { typeId: 8, id: 'mace', tribeType: 2, mainType: 4, jobType: 6 },
      // a row with NO jobType — dropped from the grouping (no undefined bucket)
      { typeId: 9, id: 'no_job', tribeType: 1, mainType: 1 },
    ],
  });
}

describe('weaponsByJob', () => {
  it('groups the weapons by the job (soldier-class) that wields them, each bucket in source order', () => {
    const byJob = weaponsByJob(jobWeaponContent());
    // two distinct wielding jobs among the rows with a jobType: swordsman=6, fighter=31.
    expect([...byJob.keys()].sort((a, b) => a - b)).toEqual([6, 31]);
    // job 6 wields both the sword and the mace, sword_short before mace (content.weapons order)
    expect(byJob.get(6)?.map((w) => w.id)).toEqual(['sword_short', 'mace']);
    expect(byJob.get(31)?.map((w) => w.id)).toEqual(['fist']);
  });

  it('omits a weapon with no jobType (no undefined bucket)', () => {
    const byJob = weaponsByJob(jobWeaponContent());
    // the no_job row is dropped, so its weapon never appears in any bucket
    for (const bucket of byJob.values()) expect(bucket.some((w) => w.id === 'no_job')).toBe(false);
    expect([...byJob.keys()].sort((a, b) => a - b)).toEqual([6, 31]);
  });

  it('is empty for content with no weapons (parseContentSet defaults weapons to [])', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    });
    expect(weaponsByJob(content).size).toBe(0);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = jobWeaponContent();
    expect(weaponsByJob(content)).toEqual(weaponsByJob(content));
  });
});

describe('weaponsForJob', () => {
  it('returns just the weapons a single job wields, in source order', () => {
    const content = jobWeaponContent();
    // job 6 (swordsman) wields the sword and the mace, in content order
    expect(weaponsForJob(content, 6).map((w) => w.id)).toEqual(['sword_short', 'mace']);
    expect(weaponsForJob(content, 31).map((w) => w.id)).toEqual(['fist']);
  });

  it('is empty for a job no weapon names', () => {
    // job 0 (idle) is a declared job but no weapon binds to it
    expect(weaponsForJob(jobWeaponContent(), 0)).toEqual([]);
  });

  it('agrees with the weaponsByJob grouping for every wielding job', () => {
    const content = jobWeaponContent();
    const byJob = weaponsByJob(content);
    for (const [job, bucket] of byJob) expect(weaponsForJob(content, job)).toEqual(bucket);
  });
});
