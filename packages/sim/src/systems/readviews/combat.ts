import type { ContentSet, WeaponType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import { armorMaterialOf } from './classes/index.js';

// Pure, terminal read views for combat — the static weapon-vs-armor damage lookup table the CombatSystem
// reads, plus the shared damage-column resolution both it and the per-hit resolution join through.

/**
 * The armor material tier a weapon's `damagevalue <material> <value>` table is indexed by — the victim's
 * armor `materialType` (`logicdefines.inc` `ARMOR_MATERIAL_TYPE_*`, l.951). The per-material value is the
 * resolved damage: armor works by column selection, not by subtracting a mitigation. `WOOD` (6) and `HOUSE`
 * (7) are not worn armor — they are the damage a weapon does to trees/walls and to buildings. For the four
 * base armor records `materialType == typeId`, so column and armor class coincide there.
 */
export const ARMOR_MATERIAL = {
  /** No armor — a bare target (`damage["0"]`). */
  NONE: 0,
  WOOL: 1,
  LEATHER: 2,
  CHAIN: 3,
  PLATE: 4,
  /** Stone (unused by the base armor records). */
  STONE: 5,
  /** A tree/wall target — the weapon's damage-vs-wood column (see {@link damageVsWood}). */
  WOOD: 6,
  /** A building target — the weapon's damage-vs-building column (see {@link damageVsBuilding}). */
  HOUSE: 7,
} as const;

/**
 * The coarse weapon class a `WeaponType.mainType` carries (`logicdefines.inc` `WEAPON_MAIN_TYPE_*`, l.892) —
 * the axis the fight-experience buckets key on (`progression/experience.ts` maps it to the
 * `JOB_EXPERIENCE_TYPE_FIGHT_*` id).
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
 * The damage a weapon lands on a target of armor `material` — the raw `weapon.damage[material]` value, `0`
 * when the weapon lists none. Nothing is subtracted: the `damagevalue` table pre-tabulates the per-material
 * outcome, so armor selects the column (the uniform `blockingValue 5` on every base armor record has an
 * unknown engine role — source basis — and is deliberately not applied).
 */
export function weaponDamageVsMaterial(weapon: Pick<WeaponType, 'damage'>, material: number): number {
  return weapon.damage[String(material)] ?? 0;
}

/**
 * The damage a weapon does to a tree/wall target — its {@link ARMOR_MATERIAL.WOOD} column, not an armor tier,
 * so it is not one of the living-target rows {@link combatDamage} tabulates.
 */
export function damageVsWood(weapon: Pick<WeaponType, 'damage'>): number {
  return weaponDamageVsMaterial(weapon, ARMOR_MATERIAL.WOOD);
}

/**
 * The damage a weapon does to a building target — its {@link ARMOR_MATERIAL.HOUSE} column, not an armor tier,
 * so it is not one of the living-target rows {@link combatDamage} tabulates.
 */
export function damageVsBuilding(weapon: Pick<WeaponType, 'damage'>): number {
  return weaponDamageVsMaterial(weapon, ARMOR_MATERIAL.HOUSE);
}

/**
 * The armor material tier a worn `armorClass` (an {@link import('@open-northland/data').ArmorType} `typeId`)
 * resolves to — the column {@link weaponDamageVsMaterial} indexes, read off the class's `[armortype]` record.
 * A class with no record (a bare 0, an out-of-table 6/7 stamped on a structure target, or a bad id) returns
 * the class value itself as its own material column, so an undefined tier resolves to some column rather
 * than crashing.
 */
export function armorMaterialForClass(content: ContentSet, armorClass: number): number {
  const armor = contentIndex(content).armor.get(armorClass);
  if (armor === undefined) return armorClass; // no record — the class value is its own column
  return armorMaterialOf(armor) ?? armor.typeId; // materialType (== typeId for the 4 base armors)
}

/**
 * One row of the {@link combatDamage} view — a single weapon resolved against **one** armor material:
 * how much damage it lands on a target of that material.
 */
interface CombatDamageRow {
  /** The target's armor material tier — the column the weapon's `damagevalue <material> <value>` table is
   *  indexed by ({@link ARMOR_MATERIAL}). */
  material: number;
  /** The weapon's damage against this material (`weapon.damage[material]`); `0` if it lists none. */
  damage: number;
}

/**
 * One weapon's combat profile in the {@link combatDamage} view — its identity (the composite
 * `(tribeType, typeId)`, exactly as the cross-ref system keys `weapontypes`, plus the `id` slug for
 * display) and its resolved {@link CombatDamageRow}s, one per armor material a living target can wear.
 */
export interface CombatProfile {
  /** Owning tribe (`WeaponType.tribeType`) — part of the `(tribeType, typeId)` identity. */
  tribeType: number | undefined;
  /** The weapon's `typeId` — recurs per tribe, so not globally unique on its own. */
  typeId: number;
  /** The weapon's `id` slug (`"fist"`, `"wooden_spear"`, …) — also not globally unique. */
  id: string;
  /** The composite key `"<tribeType>:<typeId>"` ({@link weaponKey}), surfaced so a consumer can index by it
   *  (animal weapons reuse a pair — see {@link combatDamage}). */
  key: string;
  /** Damage vs. every armor material a living target can wear, ascending by `material`. */
  rows: readonly CombatDamageRow[];
}

/**
 * The combat damage table as a derived read view over `content`: each {@link WeaponType} joined against every
 * armor material a living target can wear — the union of the unarmored material `0` and every `[armortype]`
 * record's `materialType`, sorted ascending, so a weapon that lists no value for a tier still gets a
 * `0`-damage row. The structure columns {@link ARMOR_MATERIAL.WOOD}/`HOUSE` are not rows here (see
 * {@link damageVsWood}/{@link damageVsBuilding}). Surfaced once so a hit doesn't re-walk the two tables.
 *
 * An array of {@link CombatProfile} in `content.weapons` source order, not a Map: no weapon key is globally
 * unique — `typeId` recurs per tribe (`2 = "fist"` for every tribe), and the animal weapons reuse even the
 * composite `(tribeType, typeId)` (tribe 5 has both `chicken` and `claw` at typeId 1), so a Map would
 * silently drop records last-wins.
 *
 * source-basis: the extracted `weapontypes` `damagevalue` params, keyed by the victim's armor `materialType`
 * (`logicdefines.inc ARMOR_MATERIAL_TYPE`) — the original's own column-selection model.
 */
export function combatDamage(content: ContentSet): CombatProfile[] {
  // The armor materials a living target can wear: the unarmored material 0 + every armor record's
  // materialType.
  const materials = new Set<number>([ARMOR_MATERIAL.NONE]);
  for (const armor of content.armor) materials.add(armorMaterialOf(armor) ?? armor.typeId);
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
 * The composite key naming a weapon's cross-ref identity — `"<tribeType>:<typeId>"`, mirroring how the
 * extractor keys `weapontypes`; a weapon with no `tribeType` keys under the empty-tribe slot (`":<typeId>"`).
 * A few animal weapons reuse even this pair, so it identifies a weapon's class but is not a unique key — see
 * {@link combatDamage}.
 */
export function weaponKey(weapon: Pick<WeaponType, 'tribeType' | 'typeId'>): string {
  return `${weapon.tribeType ?? ''}:${weapon.typeId}`;
}
