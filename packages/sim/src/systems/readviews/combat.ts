import type { ArmorType, ContentSet, WeaponType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import { armorMaterialOf } from './classes/index.js';

/**
 * The armor material tier a weapon's `damagevalue <material> <value>` table is indexed by - the victim's
 * armor `materialType` (`logicdefines.inc` `ARMOR_MATERIAL_TYPE_*`, l.951). The per-material value is the
 * resolved damage: armor works by column selection, not by subtracting a mitigation. For the four base
 * armor records `materialType == typeId`, so column and armor class coincide there.
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
  /** A tree/wall target - the weapon's damage-vs-wood column (see {@link damageVsWood}). */
  WOOD: 6,
  /** A building target - the weapon's damage-vs-building column (see {@link damageVsBuilding}). */
  HOUSE: 7,
} as const;

/**
 * The coarse weapon class a `WeaponType.mainType` carries (`logicdefines.inc` `WEAPON_MAIN_TYPE_*`, l.892) -
 * the axis the fight-experience buckets key on.
 */
export const WEAPON_MAIN_TYPE = {
  NONE: 0,
  /** Fist / natural weapon (the `WEAPON_MAIN_TYPE_UNARMED` slot). */
  UNARMED: 1,
  SPEAR: 2,
  SWORD: 3,
  SABER: 4,
  AXE: 5,
  BOW: 6,
  /** Catapult (siege). */
  CATAPULT: 7,
} as const;

/**
 * The damage a weapon lands on a target of armor `material` - the raw `weapon.damage[material]` value, `0`
 * when the weapon lists none. Nothing is subtracted: the `damagevalue` table pre-tabulates the per-material
 * outcome. The uniform `blockingValue 5` on every base armor record has an unknown engine role and is
 * deliberately not applied.
 */
export function weaponDamageVsMaterial(weapon: Pick<WeaponType, 'damage'>, material: number): number {
  return weapon.damage[String(material)] ?? 0;
}

/** The damage a weapon does to a tree/wall target - its {@link ARMOR_MATERIAL.WOOD} column, not an
 *  armor tier. */
export function damageVsWood(weapon: Pick<WeaponType, 'damage'>): number {
  return weaponDamageVsMaterial(weapon, ARMOR_MATERIAL.WOOD);
}

/** The damage a weapon does to a building target - its {@link ARMOR_MATERIAL.HOUSE} column, not an
 *  armor tier. */
export function damageVsBuilding(weapon: Pick<WeaponType, 'damage'>): number {
  return weaponDamageVsMaterial(weapon, ARMOR_MATERIAL.HOUSE);
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

/** One weapon resolved against one armor material. */
interface CombatDamageRow {
  /** The target's armor material tier ({@link ARMOR_MATERIAL}). */
  material: number;
  /** Damage against that material; `0` when the weapon lists none. */
  damage: number;
}

/** One weapon's identity and its damage against every armor material a living target can wear. */
export interface CombatProfile {
  tribeType: number | undefined;
  /** Recurs per tribe, so not unique. */
  typeId: number;
  /** The weapon's `id` slug, also not unique. */
  id: string;
  /** The composite `"<tribeType>:<typeId>"` key ({@link weaponKey}), not unique either. */
  key: string;
  /** Ascending by `material`. */
  rows: readonly CombatDamageRow[];
}

/**
 * Each {@link WeaponType} joined against every armor material a living target can wear: the unarmored
 * material `0` plus every `[armortype]` record's `materialType`, ascending, so a weapon listing no value for
 * a tier still gets a `0`-damage row. The structure columns {@link ARMOR_MATERIAL.WOOD}/`HOUSE` are not rows
 * here.
 *
 * An array in `content.weapons` source order rather than a Map, because no weapon key is unique
 * ({@link weaponKey}), so a Map would silently drop records.
 */
export function combatDamage(content: ContentSet): CombatProfile[] {
  const materials = new Set<number>([ARMOR_MATERIAL.NONE]);
  for (const armor of content.armor) materials.add(materialOfRecord(armor));
  const sorted = [...materials].sort((a, b) => a - b);

  const profiles: CombatProfile[] = [];
  for (const weapon of content.weapons) {
    const rows: CombatDamageRow[] = sorted.map((material) => ({
      material,
      damage: weaponDamageVsMaterial(weapon, material),
    }));
    profiles.push({
      tribeType: weapon.tribeType,
      typeId: weapon.typeId,
      id: weapon.id,
      key: weaponKey(weapon),
      rows,
    });
  }
  return profiles;
}

/**
 * A weapon's cross-ref identity `"<tribeType>:<typeId>"`, mirroring how the extractor keys `weapontypes`; a
 * weapon with no `tribeType` keys under the empty-tribe slot. Not unique - tribe 5 carries both `chicken`
 * and `claw` at typeId 1 - so this names a weapon's class rather than one record.
 */
export function weaponKey(weapon: Pick<WeaponType, 'tribeType' | 'typeId'>): string {
  return `${weapon.tribeType ?? ''}:${weapon.typeId}`;
}
