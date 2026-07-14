import type { ContentSet, WeaponType } from '@open-northland/data';
import { groupByKey } from './group.js';

// Pure, terminal read views for the weapon/armor class taxonomy — the data-defined predicates, field
// accessors, and groupings that classify the two combat tables by the extracted
// `mainType`/`munitionType`/`damageType`/`materialType`/`weight`/`jobType` markers. No mechanic is added
// here; these are the seeds the deferred, oracle-blocked combat drives (ranged fire, siege/AoE, equip,
// carry-penalty) will switch on. Split from ./combat.ts, which keeps the static weapon-vs-armor damage
// lookup table (`combatDamage`/`weaponKey`).

/**
 * Whether a {@link WeaponType} is ranged — fires ammunition (a bow or catapult) vs a melee weapon. The
 * discriminator is the extracted `munitionType` being present (`1` = arrow, `2` = catapult projectile): only
 * rows that fire ammo carry it (30/105 weapons: 5 bow types per tribe + the catapult).
 */
export function isRangedWeapon(weapon: WeaponType): boolean {
  return weapon.munitionType !== undefined;
}

/**
 * Whether a {@link WeaponType} is a siege / area-damage weapon (the catapult) — distinguished by carrying a
 * `damageType` (the siege/AoE damage class, value `2`). Only the catapult carries it (5/105 weapons, one per
 * tribe). A siege weapon is also ranged ({@link isRangedWeapon}) but not conversely.
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
 * heaviest 2), the weapon-side twin of {@link armorWeightOf}.
 *
 * The schema defaults `weight` to 0 (`.default(0)`), so this returns a plain `number`, never `undefined`: a
 * weightless weapon reads 0 (44/105 real weapons), the same value the source carries.
 */
export function weaponWeightOf(weapon: WeaponType): number {
  return weapon.weight;
}

/**
 * The weapons grouped by their coarse class ({@link weaponClassOf}: the extracted `mainType`) —
 * `Map<mainType, WeaponType[]>`, one bucket per class. The multi-valued counterpart of the binary
 * {@link rangedWeapons}/{@link siegeWeapons} filters. Buckets are source-order arrays (a weapon's
 * `(tribeType, typeId)` isn't unique — see `combatDamage` in ./combat.ts); weapons with no `mainType` are
 * omitted (real data has none). Map iteration order is first-appearance of each class, not ascending by id —
 * a display consumer wanting id order sorts the keys itself.
 */
export function weaponsByClass(content: ContentSet): Map<number, WeaponType[]> {
  return groupByKey(content.weapons, weaponClassOf);
}

/**
 * The weapons grouped by the job (soldier-class) that wields them ({@link WeaponType.jobType}) —
 * `Map<jobType, WeaponType[]>`. The data-defined soldier-class→weapon roster: each `[weapontype]` carries a
 * `jobtype` naming the job that fights with it (`jobtype 31` = unarmed fist-fighter, `6` = swordsman), so this
 * answers "which weapons does soldier-class N wield" without hardcoding.
 *
 * `jobType` is a cross-reference into the jobs table (validated by `parseContentSet`), a many-to-one join (one
 * job wields several weapons across tribes). Buckets are source-order arrays; weapons with no `jobType` are
 * omitted. Iteration order is first-appearance, not ascending by job id (like {@link weaponsByClass}).
 */
export function weaponsByJob(content: ContentSet): Map<number, WeaponType[]> {
  return groupByKey(content.weapons, (weapon) => weapon.jobType);
}

/**
 * The weapons a single job (soldier-class) wields — the per-job slice of {@link weaponsByJob}: every
 * {@link WeaponType} whose `jobType` equals `job`, in source order. Returns a fresh array (empty if none names
 * `job`).
 */
export function weaponsForJob(content: ContentSet, job: number): WeaponType[] {
  return content.weapons.filter((w) => w.jobType === job);
}
