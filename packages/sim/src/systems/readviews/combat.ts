import type { ContentSet, WeaponType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import { armorMaterialOf } from './classes/index.js';

// Pure, terminal read views for combat — the static weapon-vs-armor damage lookup table the CombatSystem
// reads, plus the shared damage-column resolution both it and the per-hit resolution join through. No
// mechanic is added here.

/**
 * The armor material tier a weapon's `damagevalue <material> <value>` table is indexed by — the victim's
 * armor `materialType` (`logicdefines.inc` `ARMOR_MATERIAL_TYPE_*`, l.951). The per-material value in the
 * weapon's table is the resolved damage: armor works by column selection, not by subtracting a mitigation.
 * `NONE` (0) is a bare target (`damage["0"]`). `WOOD` (6) and `HOUSE` (7) are not worn armor — they are the
 * damage a weapon does to trees/walls and to buildings, surfaced by {@link damageVsWood}/{@link damageVsBuilding}.
 * For the four base armor records `materialType == typeId` (woolen 1 / leather 2 / chain 3 / plate 4), so the
 * column and the armor class coincide there.
 *
 * source-basis: `logicdefines.inc` `ARMOR_MATERIAL_TYPE_*` (golden rule #4).
 */
export const ARMOR_MATERIAL = {
  /** No armor — a bare target (`damage["0"]`). */
  NONE: 0,
  /** Woolen. */
  WOOL: 1,
  /** Leather. */
  LEATHER: 2,
  /** Chain mail. */
  CHAIN: 3,
  /** Plate. */
  PLATE: 4,
  /** Stone (unused by the base armor records). */
  STONE: 5,
  /** A tree/wall target — the weapon's damage-vs-wood column (see {@link damageVsWood}). */
  WOOD: 6,
  /** A building target — the weapon's damage-vs-building column (see {@link damageVsBuilding}). */
  HOUSE: 7,
} as const;

/**
 * The coarse weapon class a `WeaponType.mainType` carries (`logicdefines.inc` `WEAPON_MAIN_TYPE_*`, l.892).
 * The attacker's weapon family, the axis the fight-experience buckets key on (`progression/experience.ts`
 * maps it to the `JOB_EXPERIENCE_TYPE_FIGHT_*` id).
 *
 * source-basis: `logicdefines.inc` `WEAPON_MAIN_TYPE_*` — the original's own class ids.
 */
export const WEAPON_MAIN_TYPE = {
  /** No weapon. */
  NONE: 0,
  /** Fist / natural weapon (the `WEAPON_MAIN_TYPE_UNARMED` slot). */
  UNARMED: 1,
  /** Spear. */
  SPEAR: 2,
  /** Sword. */
  SWORD: 3,
  /** Saber. */
  SABER: 4,
  /** Axe. */
  AXE: 5,
  /** Bow. */
  BOW: 6,
  /** Catapult (siege). */
  CATAPULT: 7,
} as const;

/**
 * The damage a weapon lands on a target of armor `material` — the raw `weapon.damage[material]` value, `0`
 * when the weapon lists none. This is the resolved damage: the `damagevalue` table pre-tabulates the
 * per-material outcome, so armor selects the column and nothing is subtracted (the uniform `blockingValue 5`
 * on every base armor record has an unknown engine role — source basis — and is deliberately not applied).
 * Shared by {@link combatDamage} (the whole table) and the CombatSystem's per-hit resolution (one column),
 * so the two can't drift.
 */
export function weaponDamageVsMaterial(weapon: Pick<WeaponType, 'damage'>, material: number): number {
  return weapon.damage[String(material)] ?? 0;
}

/**
 * The damage a weapon does to a **tree/wall** target — its {@link ARMOR_MATERIAL.WOOD} column. A read
 * view (not an armor tier): the gathering/siege drives that chop trees or breach palisades read this,
 * separate from the living-target rows {@link combatDamage} tabulates.
 */
export function damageVsWood(weapon: Pick<WeaponType, 'damage'>): number {
  return weaponDamageVsMaterial(weapon, ARMOR_MATERIAL.WOOD);
}

/**
 * The damage a weapon does to a **building** target — its {@link ARMOR_MATERIAL.HOUSE} column. A read
 * view (not an armor tier): the deferred tower/siege step that lets a weapon damage a structure reads
 * this, separate from the living-target rows {@link combatDamage} tabulates.
 */
export function damageVsBuilding(weapon: Pick<WeaponType, 'damage'>): number {
  return weaponDamageVsMaterial(weapon, ARMOR_MATERIAL.HOUSE);
}

/**
 * The armor material tier a worn `armorClass` (an {@link import('@open-northland/data').ArmorType} `typeId`)
 * resolves to — the column {@link weaponDamageVsMaterial} indexes. Resolves the class's `[armortype]` record
 * and reads its `materialType` (== `typeId` for the four base armors). A class with no record (a bare 0, an
 * out-of-table 6/7 stamped on a structure target, or a bad id) returns the class value itself as its own
 * material column, so an undefined tier resolves to some column rather than crashing.
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
export interface CombatDamageRow {
  /** The target's armor **material tier** — the column the weapon's `damagevalue <material> <value>`
   *  table is indexed by ({@link ARMOR_MATERIAL}: 0 unarmored, 1 wool, 2 leather, 3 chain, 4 plate). */
  material: number;
  /** The weapon's damage against this material (`weapon.damage[material]`) — the value the original
   *  pre-resolves per material (armor selects the column; nothing is subtracted). `0` if the weapon lists
   *  no value for this material. */
  damage: number;
}

/**
 * One weapon's combat profile in the {@link combatDamage} view — its identity (the composite
 * `(tribeType, typeId)`, exactly as the cross-ref system keys `weapontypes`, plus the `id` slug for
 * display) and its resolved {@link CombatDamageRow}s, one per armor material a living target can wear.
 */
export interface CombatProfile {
  /** Owning tribe (`WeaponType.tribeType`) — part of the canonical `(tribeType, typeId)` identity. */
  tribeType: number | undefined;
  /** The weapon's `typeId` — not globally unique on its own (recurs per tribe); paired with
   *  `tribeType` for identity, and even that pair is reused for a few animal weapons (see the fn doc). */
  typeId: number;
  /** The weapon's `id` slug (`"fist"`, `"wooden_spear"`, …) — also not globally unique. */
  id: string;
  /** The composite key `"<tribeType>:<typeId>"` ({@link weaponKey}) — the cross-ref identity, surfaced
   *  so a consumer can index by it (mind that animal weapons reuse a pair; see the fn doc). */
  key: string;
  /** Damage vs. every armor material a living target can wear, ascending by `material`. */
  rows: readonly CombatDamageRow[];
}

/**
 * The combat damage table as a derived read view over `content` — the read half of the CombatSystem: it
 * joins each {@link WeaponType} against every armor material a living target can wear (the unarmored material
 * `0` plus each `[armortype]` record's `materialType`), tabulating the damage the weapon lands
 * (`weapon.damage[material]`). No mitigation is subtracted (armor works by column selection; the uniform
 * `blockingValue 5` has an unknown engine role — source basis), and the structure columns
 * {@link ARMOR_MATERIAL.WOOD}/`HOUSE` are not rows here — they are the vs-tree/vs-building views
 * ({@link damageVsWood}/{@link damageVsBuilding}). This is the static lookup the combat atomics read,
 * surfaced once so a hit doesn't re-walk the two tables.
 *
 * The materials covered are the union of the unarmored material `0` and every `content.armor` record's
 * `materialType` (== `typeId` for the four base armors), sorted ascending — so every armor tier gets a row
 * and a weapon that lists no value for a tier still gets a `0`-damage row.
 *
 * Returned as an array of {@link CombatProfile}, one per `content.weapons` entry in source order — not a Map
 * keyed by weapon identity, deliberately: no weapon key is globally unique. A `WeaponType.typeId` recurs per
 * tribe (`2 = "fist"` for every tribe), so we carry the composite `(tribeType, typeId)` `key`; but the animal
 * weapons reuse even that pair (tribe 5 has both `chicken` and `claw` at typeId 1; tribe 8 lists `bearfist`
 * twice), so a Map would silently drop those records (last-wins). An array loses nothing. Each profile's
 * `rows` are sorted ascending by `material`.
 *
 * source-basis: the extracted `weapontypes` `damagevalue` params, keyed by the victim's armor `materialType`
 * (`logicdefines.inc ARMOR_MATERIAL_TYPE`) — the original's own column-selection model (source basis "Combat
 * damage read side"). It adds no behavior — this is only the lookup table for a separate combat mechanic.
 */
export function combatDamage(content: ContentSet): CombatProfile[] {
  // The armor materials a living target can wear: the unarmored material 0 + every armor record's
  // materialType. The structure columns (6/7) are not rows — they are damageVsWood/damageVsBuilding.
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
 * The composite key naming a weapon's cross-ref identity — `"<tribeType>:<typeId>"`. A `WeaponType.typeId` is
 * not globally unique (it recurs once per tribe — `2 = "fist"` for every tribe), so a weapon is keyed by both
 * ids; a weapon with no `tribeType` keys under the empty-tribe slot (`":<typeId>"`). Mirrors how the extractor
 * keys `weapontypes` by `(tribeType, typeId)`. Even this pair is reused by a few animal weapons, so it
 * identifies a weapon's class but is not a unique key — see {@link combatDamage}.
 */
export function weaponKey(weapon: Pick<WeaponType, 'tribeType' | 'typeId'>): string {
  return `${weapon.tribeType ?? ''}:${weapon.typeId}`;
}
