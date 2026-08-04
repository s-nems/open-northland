import type { ContentSet, WeaponType } from '@open-northland/data';
import { groupByKey } from './group.js';

/** A present `munitionType` (`1` = arrow, `2` = catapult projectile) marks the rows that fire ammunition. */
export function isRangedWeapon(weapon: WeaponType): boolean {
  return weapon.munitionType !== undefined;
}

/**
 * A present `damageType` (`2`, the area class) marks a siege weapon, which only the catapult carries.
 * Siege implies ranged, not the reverse.
 */
export function isSiegeWeapon(weapon: WeaponType): boolean {
  return weapon.damageType !== undefined;
}

/**
 * In `content.weapons` source order rather than keyed: a weapon's `typeId` recurs per tribe and even the
 * `(tribeType, typeId)` pair is reused, so a keyed collection would drop records.
 */
export function rangedWeapons(content: ContentSet): WeaponType[] {
  return content.weapons.filter(isRangedWeapon);
}

/** A strict subset of {@link rangedWeapons}, in source order for the same reason. */
export function siegeWeapons(content: ContentSet): WeaponType[] {
  return content.weapons.filter(isSiegeWeapon);
}

/** The extracted `mainType`, `1..7` for fist, club, sword, axe, spear, bow, catapult. */
export function weaponClassOf(weapon: WeaponType): number | undefined {
  return weapon.mainType;
}

/**
 * Encumbrance weight `0..2`: fist and dagger 0, most weapons 1, the heaviest 2. The schema defaults it to
 * 0, so a weightless weapon reads the same 0 the source carries.
 */
export function weaponWeightOf(weapon: WeaponType): number {
  return weapon.weight;
}

/**
 * Buckets are source-order arrays and weapons without a `mainType` are omitted. Map iteration follows
 * first appearance of each class, so a consumer wanting id order sorts the keys itself.
 */
export function weaponsByClass(content: ContentSet): Map<number, WeaponType[]> {
  return groupByKey(content.weapons, weaponClassOf);
}

/**
 * The data-defined soldier-class roster: each `[weapontype]` carries a `jobtype` naming the job that
 * fights with it. The join is many-to-one, since one job wields several weapons across tribes; ordering
 * matches {@link weaponsByClass}.
 */
export function weaponsByJob(content: ContentSet): Map<number, WeaponType[]> {
  return groupByKey(content.weapons, (weapon) => weapon.jobType);
}

/** The per-job slice of {@link weaponsByJob}, as a fresh source-order array. */
export function weaponsForJob(content: ContentSet, job: number): WeaponType[] {
  return content.weapons.filter((w) => w.jobType === job);
}
