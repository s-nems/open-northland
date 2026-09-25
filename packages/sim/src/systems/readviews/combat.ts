import type { ArmorType, ContentSet, WeaponType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import { armorMaterialOf } from './classes/index.js';

/**
 * The armor material tier a weapon's `damagevalue <material> <value>` table is indexed by - the victim's
 * armor `materialType` (`logicdefines.inc` `ARMOR_MATERIAL_TYPE_*`, l.951). For the four base armor
 * records `materialType == typeId`, so column and armor class coincide there.
 */
export const ARMOR_MATERIAL = {
  /** No armor - a bare target (`damage["0"]`). */
  NONE: 0,
  WOOL: 1,
  LEATHER: 2,
  CHAIN: 3,
  PLATE: 4,
  /** Stone (unused by the base armor records). */
  STONE: 5,
  /** A tree/wall target - the weapon's damage-vs-wood column, also the one a vehicle takes. */
  WOOD: 6,
  /** A vehicle target reads the same column, `damage[6]`, with an armour of 0 (original behavior,
   *  docs/formats/VEHICLES.md). */
  VEHICLE: 6,
  /** A building target - the weapon's damage-vs-building column. */
  HOUSE: 7,
} as const;

/**
 * The coarse weapon class a `WeaponType.mainType` carries (`logicdefines.inc` `WEAPON_MAIN_TYPE_*`, l.892) -
 * the axis the fight-experience buckets key on. The saber rows' 4 and the hero axe's 5 are left out: the
 * sim gives those weapons no class and no fight bucket, as the original gives them no bucket.
 */
export const WEAPON_MAIN_TYPE = {
  NONE: 0,
  /** Fist / natural weapon (the `WEAPON_MAIN_TYPE_UNARMED` slot). */
  UNARMED: 1,
  SPEAR: 2,
  SWORD: 3,
  BOW: 6,
  /** Catapult (siege). */
  CATAPULT: 7,
} as const;

/**
 * The column a weapon lands on a target of armor `material` - the raw `weapon.damage[material]` value, `0`
 * when the weapon lists none. The base a blow's damage starts from, before experience, direction and the
 * armor's `blockingValue`.
 */
export function weaponDamageVsMaterial(weapon: Pick<WeaponType, 'damage'>, material: number): number {
  return weapon.damage[String(material)] ?? 0;
}

/** An `[armortype]` record's damage column: its `materialType`, or its `typeId` where the record carries
 *  none (the two coincide for the 4 base armors). */
function materialOfRecord(armor: ArmorType): number {
  return armorMaterialOf(armor) ?? armor.typeId;
}

/**
 * The armor material tier a worn `armorClass` (an `ArmorType` `typeId`) resolves to - the column
 * {@link weaponDamageVsMaterial} indexes. A class with no `[armortype]` record returns the class value
 * itself as its own column, so an undefined tier still resolves rather than failing.
 */
export function armorMaterialForClass(content: ContentSet, armorClass: number): number {
  const armor = contentIndex(content).armor.get(armorClass);
  if (armor === undefined) return armorClass;
  return materialOfRecord(armor);
}

/**
 * The armor material tier a worn armor good presents: the `[armortype]` record whose `goodtype` is that
 * good, resolved to its `materialType` column. Null when no record claims the good.
 */
export function armorMaterialForGood(content: ContentSet, goodType: number): number | null {
  const armor = contentIndex(content).armorByGoodType.get(goodType);
  if (armor === undefined) return null;
  return materialOfRecord(armor);
}

/**
 * A weapon's cross-ref identity `"<tribeType>:<typeId>"`, mirroring how the extractor keys `weapontypes`; a
 * weapon with no `tribeType` keys under the empty-tribe slot. Not unique - tribe 5 carries both `chicken`
 * and `claw` at typeId 1 - so this names a weapon's class rather than one record.
 */
export function weaponKey(weapon: Pick<WeaponType, 'tribeType' | 'typeId'>): string {
  return `${weapon.tribeType ?? ''}:${weapon.typeId}`;
}
