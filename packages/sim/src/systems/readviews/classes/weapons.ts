import type { WeaponType } from '@open-northland/data';

/** A present `munitionType` (`1` = arrow, `2` = catapult projectile) marks the rows that fire ammunition. */
export function isRangedWeapon(weapon: WeaponType): boolean {
  return weapon.munitionType !== undefined;
}

/** `damagetype 2`: a shot that strikes everything on its landing point and the six around it. Original
 *  behavior. */
const AREA_DAMAGE_TYPE = 2;

/** Whether `weapon`'s shot strikes an area rather than the first thing where it lands. */
export function isAreaWeapon(weapon: Pick<WeaponType, 'damageType'>): boolean {
  return weapon.damageType === AREA_DAMAGE_TYPE;
}

/**
 * A present `damageType` (`2`, the area class) marks a siege weapon, which only the catapult carries.
 * Siege implies ranged, not the reverse.
 */
export function isSiegeWeapon(weapon: WeaponType): boolean {
  return weapon.damageType !== undefined;
}

/** The extracted `mainType`: 1 fist, 2 spear, 3 sword, 4 saber, 5 hero axe, 6 bow, 7 catapult. */
export function weaponClassOf(weapon: WeaponType): number | undefined {
  return weapon.mainType;
}
