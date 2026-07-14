import type { ContentSet, WeaponType } from '@open-northland/data';

// Pure, terminal read views for the weapon/armor class taxonomy — the data-defined predicates, field
// accessors, and groupings that classify the two combat tables by the extracted
// `mainType`/`munitionType`/`damageType`/`materialType`/`weight`/`jobType` markers. No mechanic is added
// here; these are the seeds the deferred, oracle-blocked combat drives (ranged fire, siege/AoE, equip,
// carry-penalty) will switch on. Split from ./combat.ts, which keeps the static weapon-vs-armor damage
// lookup table (`combatDamage`/`weaponKey`).

/**
 * Whether a {@link WeaponType} is ranged — a weapon that fires ammunition (a bow or a catapult) vs a melee
 * weapon. The discriminator is the extracted `munitionType` being present: only rows that fire ammo carry a
 * `munitiontype` (`1` = arrow, `2` = catapult projectile), so its presence is the data-pinned "this weapon
 * shoots" marker (30/105 weapons: the 5 bow types per tribe + the catapult). The seed the deferred
 * ranged-attack drive switches on (a bow's `[minRange,maxRange]` band already gates its reach in
 * `attackerWeapon`; the fire-from-afar behavior is the unbuilt half).
 */
export function isRangedWeapon(weapon: WeaponType): boolean {
  return weapon.munitionType !== undefined;
}

/**
 * Whether a {@link WeaponType} is a siege / area-damage weapon (the catapult) — distinguished by carrying a
 * `damageType` (the siege/AoE damage class, value `2`). Only the catapult carries a `damagetype` (5/105
 * weapons, one per tribe), so its presence is the data-pinned marker. A siege weapon is also ranged
 * ({@link isRangedWeapon}) but not conversely (a bow is ranged yet not siege). The seed the deferred
 * siege/AoE combat-resolution drive switches on.
 */
export function isSiegeWeapon(weapon: WeaponType): boolean {
  return weapon.damageType !== undefined;
}

/**
 * The ranged weapon types — the bow/catapult rows that fire ammunition ({@link isRangedWeapon}).
 *
 * Returned as a {@link WeaponType} array in `content.weapons` source order, not keyed by `typeId` or
 * `(tribeType, typeId)`: those recur per tribe and even the composite pair is reused by a few animal weapons
 * (see `combatDamage`/`weaponKey` in ./combat.ts), so a keyed collection would silently drop records.
 */
export function rangedWeapons(content: ContentSet): WeaponType[] {
  return content.weapons.filter(isRangedWeapon);
}

/**
 * The siege weapon types — the catapult rows that deal area/siege damage ({@link isSiegeWeapon}); a strict
 * subset of {@link rangedWeapons}. Returned as a {@link WeaponType} array in `content.weapons` source order,
 * lossless like {@link rangedWeapons}.
 */
export function siegeWeapons(content: ContentSet): WeaponType[] {
  return content.weapons.filter(isSiegeWeapon);
}

/**
 * A {@link WeaponType}'s coarse weapon class — its extracted `mainType` (`1..7`:
 * fist/club/sword/axe/spear/bow/catapult), or `undefined` if the row carries none. Unlike the presence
 * markers {@link isRangedWeapon}/{@link isSiegeWeapon}, `mainType` is a multi-valued class enum carried by
 * every weapon (all 105 rows, across all 7 classes), so its read view is a grouping ({@link weaponsByClass}),
 * not a filter. This accessor is the field reader that grouping keys on.
 */
export function weaponClassOf(weapon: WeaponType): number | undefined {
  return weapon.mainType;
}

/**
 * A {@link WeaponType}'s encumbrance weight — its extracted `weight` (`0..2`: fist/dagger 0, most weapons 1,
 * heaviest 2), the weapon-side twin of {@link armorWeightOf}. The per-weapon load a deferred
 * carry/movement-penalty drive would read to slow a laden soldier.
 *
 * The schema defaults `weight` to 0 (`.default(0)`), so this returns a plain `number`, never `undefined`: a
 * weightless weapon reads 0 (44/105 real weapons), the same value the source carries — there is no "no
 * record" sentinel.
 */
export function weaponWeightOf(weapon: WeaponType): number {
  return weapon.weight;
}

/**
 * The weapons grouped by their coarse class ({@link weaponClassOf}: the extracted `mainType`) —
 * `Map<mainType, WeaponType[]>`, one bucket per class. The multi-valued counterpart of the binary
 * {@link rangedWeapons}/{@link siegeWeapons} filters.
 *
 * Each bucket is a {@link WeaponType} array in `content.weapons` source order — the values must be arrays,
 * not a keyed collection, since a weapon's `(tribeType, typeId)` isn't unique (see `combatDamage` in
 * ./combat.ts). Weapons with no `mainType` are omitted; real data has none, so this only drops a malformed
 * fixture row.
 *
 * The Map's iteration order is insertion order = first-appearance of each class (not ascending by class id):
 * a Map-valued read view may be built by one non-canonical pass because its values are order-independent per
 * bucket and no system branches a game decision on it. A display consumer wanting id order must sort the
 * keys itself.
 */
export function weaponsByClass(content: ContentSet): Map<number, WeaponType[]> {
  const byClass = new Map<number, WeaponType[]>();
  for (const weapon of content.weapons) {
    const cls = weaponClassOf(weapon);
    if (cls === undefined) continue; // no class — drop it (real data has none)
    const bucket = byClass.get(cls);
    if (bucket === undefined) byClass.set(cls, [weapon]);
    else bucket.push(weapon);
  }
  return byClass;
}

/**
 * The weapons grouped by the job (soldier-class) that wields them ({@link WeaponType.jobType}) —
 * `Map<jobType, WeaponType[]>`, one bucket per wielding job. The data-defined soldier-class→weapon roster
 * join: each `[weapontype]` carries a `jobtype` naming the job that fights with it (`jobtype 31` = unarmed
 * fist-fighter, `6` = swordsman), so this answers "which weapons does soldier-class N wield" without
 * hardcoding a binding. The equip behavior is the unbuilt, oracle-blocked drive; this is only its lookup.
 *
 * `jobType` is a cross-reference into the jobs table (validated by `parseContentSet`, so every key resolves
 * to a real `[jobtype]`), a many-to-one join like `mainType` (one job wields several weapons across tribes —
 * `jobtype 31` covers 7 records). Each bucket is a {@link WeaponType} array in source order (values must be
 * arrays because one job wields several weapons); weapons with no `jobType` are omitted (real data has none).
 * Iteration order is insertion order, not ascending by job id (same idiom as {@link weaponsByClass}); a
 * consumer wanting id order sorts the keys itself.
 */
export function weaponsByJob(content: ContentSet): Map<number, WeaponType[]> {
  const byJob = new Map<number, WeaponType[]>();
  for (const weapon of content.weapons) {
    const job = weapon.jobType;
    if (job === undefined) continue; // no wielding job — drop it (real data has none)
    const bucket = byJob.get(job);
    if (bucket === undefined) byJob.set(job, [weapon]);
    else bucket.push(weapon);
  }
  return byJob;
}

/**
 * The weapons a single job (soldier-class) wields — the per-job slice of {@link weaponsByJob}: every
 * {@link WeaponType} whose `jobType` equals `job`, in source order. The roster lookup the deferred equip
 * drive joins on (it adds no equip behavior). Returns a fresh array (empty if none names `job`).
 */
export function weaponsForJob(content: ContentSet, job: number): WeaponType[] {
  return content.weapons.filter((w) => w.jobType === job);
}
