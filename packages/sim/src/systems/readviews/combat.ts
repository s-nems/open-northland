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
 * the axis the fight-experience buckets key on. Original behavior: the saber and the hero axe train no
 * bucket; our rule gives them the personal counter like every class but the catapult.
 */
export const WEAPON_MAIN_TYPE = {
  NONE: 0,
  /** Fist / natural weapon (the `WEAPON_MAIN_TYPE_UNARMED` slot). */
  UNARMED: 1,
  SPEAR: 2,
  SWORD: 3,
  /** The saber rows' class. */
  SABER: 4,
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

const protectionOrders = new WeakMap<ContentSet, readonly number[]>();

/**
 * Every armor good, the best protection first: the least damage summed over every weapon's column for
 * its material, the good id breaking a tie. Approximation: each weapon counts once, however often it is
 * met. The list is shared: read it, never edit it.
 */
export function armorGoodsByProtection(content: ContentSet): readonly number[] {
  const held = protectionOrders.get(content);
  if (held !== undefined) return held;
  const taken = new Map<number, number>();
  for (const armor of content.armor) {
    if (armor.goodType === undefined || taken.has(armor.goodType)) continue;
    const material = materialOfRecord(armor);
    let sum = 0;
    for (const weapon of content.weapons) sum += weaponDamageVsMaterial(weapon, material);
    taken.set(armor.goodType, sum);
  }
  const order = [...taken.keys()].sort((a, b) => (taken.get(a) ?? 0) - (taken.get(b) ?? 0) || a - b);
  protectionOrders.set(content, order);
  return order;
}

const strengthOrders = new WeakMap<ContentSet, Map<number, readonly number[]>>();

/**
 * Every weapon good of class `mainType` that arms someone (a row with a `jobtype`), across all tribes,
 * strongest first: the best bare-target damage any of its rows deals, the good id breaking a tie. The
 * list is shared: read it, never edit it.
 */
export function weaponGoodsByStrength(content: ContentSet, mainType: number): readonly number[] {
  let byClass = strengthOrders.get(content);
  if (byClass === undefined) {
    byClass = new Map();
    strengthOrders.set(content, byClass);
  }
  const held = byClass.get(mainType);
  if (held !== undefined) return held;
  const best = new Map<number, number>();
  for (const weapon of content.weapons) {
    if (weapon.mainType !== mainType || weapon.goodType === undefined || weapon.jobType === undefined)
      continue;
    const damage = weaponDamageVsMaterial(weapon, ARMOR_MATERIAL.NONE);
    best.set(weapon.goodType, Math.max(best.get(weapon.goodType) ?? 0, damage));
  }
  const order = [...best.keys()].sort((a, b) => (best.get(b) ?? 0) - (best.get(a) ?? 0) || a - b);
  byClass.set(mainType, order);
  return order;
}
