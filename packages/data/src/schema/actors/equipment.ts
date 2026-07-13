import { z } from 'zod';
import { ClassId, Provenance, TypeId } from '../record.js';

/**
 * A character-equipment category — the slot kind a good occupies when a Viking carries it. The
 * original's equippable goods are `goodtypes.ini` ids 30–55 (confirmed by each tribe's `allowequip`
 * list in `tribetypes.ini`, and the manual's Equipment section: "You can equip your Vikings with
 * shoes, tools, mead, potions and amulets" + soldiers additionally with weapons and armour). Weapons
 * and armour are soldier-only; shoes/tools/consumables anyone. This is the SLOT category; the sim's
 * `Equipment` component groups worn goods by it. Lives here beside the {@link WeaponType}/{@link ArmorType}
 * equipment types (a good's {@link import('../economy/goods.js').GoodType.equip} references it).
 */
export const EQUIP_CATEGORIES = ['boots', 'tool', 'weapon', 'armor', 'misc'] as const;
export const EquipCategory = z.enum(EQUIP_CATEGORIES);
export type EquipCategory = z.infer<typeof EquipCategory>;

/**
 * A good's equipment classification — present only on the equippable goods (the original's ids 30–55).
 * `category` names the slot kind; `wears` marks whether the item is used up in use. The wear split is
 * source-pinned to the manual: potions, shoes and tools are "slowly used up" ("Partly used items
 * (potions, shoes, ...) you drop are lost"), while "unused items such as weapons, armour and amulets
 * can be used again" (amulets: "their power is never diminished"). The per-use consumption MAGNITUDE
 * is engine-hardcoded (no numeric field exists in any readable `.ini` — verified), so no rate lives
 * here; a wearing item just carries a "degree of use" the UI shows as a percentage.
 */
export const EquipClass = z.strictObject({
  category: EquipCategory,
  /** True when the item is consumed with use (potions/shoes/tools); false for permanent gear
   *  (weapons/armour/amulets). Source basis: manual Equipment section (see {@link EquipClass}). */
  wears: z.boolean().default(false),
});
export type EquipClass = z.infer<typeof EquipClass>;

export const WeaponType = z.strictObject({
  /** The weapon's `type` id. NOTE: unlike the other type tables this is NOT globally unique — a
   *  weapon is keyed by `(tribeType, typeId)` in the original `weapontypes`, so the same `typeId`
   *  (e.g. 2 = "fist") recurs once per tribe. Resolve a weapon with both ids, not `typeId` alone. */
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** Owning tribe (`weapontype` `tribetype`). Part of the composite key — see `typeId`. */
  tribeType: TypeId.optional(),
  /**
   * `mainType` — the coarse **weapon class** (1..7 in the base data: fist/club/sword/axe/spear/bow/…),
   * the weapon-side twin of {@link ArmorType.mainType}. NOT a cross-ref into another table (it's a
   * class enum, not a foreign key) — a soldier-class→weapon-class binding prerequisite the deferred
   * combat-roster slice joins on, captured ahead of that drive. */
  mainType: ClassId.optional(),
  /** `weight` — the encumbrance the weapon adds (0..2 in the base data), the weapon-side twin of
   *  {@link ArmorType.weight}. */
  weight: z.number().int().nonnegative().default(0),
  /**
   * `munitiontype` — the **ammunition class** a *ranged* weapon fires (only bows and catapults carry
   * it in the base data): 1 = bow ammo / arrow, 2 = catapult projectile. Like {@link mainType} it is a
   * class enum, **not** a cross-ref into another table (`munitiontype` appears in no other `.ini`, and
   * the values 1/2 are NOT good ids — good 1 is "water", good 2 is "mud"), so it's captured as a plain
   * id with no cross-ref check. **Absent on melee weapons** (a fist/sword fires nothing → `undefined`),
   * making it the data-pinned "is this weapon ranged" marker the deferred ranged-attack drive reads. */
  munitionType: ClassId.optional(),
  /**
   * `speed` — a **ranged** weapon's projectile **travel speed** (short/long bow `8`, house bow `7`,
   * catapult `3` in the base data — a bow's arrow flies faster than a catapult's rock). Carried only by
   * the rows that also carry a {@link munitionType} (bows + catapults); **absent on every melee weapon**
   * (→ `undefined`), the {@link munitionType} twin. Captured as a plain non-negative int (a magnitude,
   * not a cross-ref — `speed` appears in no other table). The **UNIT is unreadable** (tiles/tick? — the
   * source carries no scale), so the ranged-combat drive maps it onto a per-tick step via a named
   * calibration constant (source basis "Combat ranged projectiles"); the extracted value itself is faithful. */
  speed: z.number().int().nonnegative().optional(),
  /**
   * `damagetype` — the **damage class** a weapon deals (a siege/area marker in the base data: only the
   * catapults carry it, value `2`). Like {@link mainType} and {@link munitionType} it is a class enum,
   * **not** a cross-ref into another table (`damagetype` appears in no other `.ini`, and `2` is not a
   * good id — good 2 is "mud"), so it's captured as a plain id with no cross-ref check. **Absent on
   * every non-catapult weapon** (→ `undefined`), so it marks the siege/AoE damage class the deferred
   * combat-resolution drive reads, the twin of {@link munitionType}'s "is ranged" marker. */
  damageType: ClassId.optional(),
  minRange: z.number().int().nonnegative().default(1),
  maxRange: z.number().int().nonnegative().default(1),
  /**
   * `damageValue[targetArmorClass] -> value`, as in the original weapontypes. Keyed by the numeric
   * armor {@link ClassId} the hit lands on (the string form the read view resolves with
   * `damage[String(armorClass)]`; JSON object keys are strings on disk). Values are whole
   * hit-points — every base weapon's `damageValue` is an integer — so they are constrained to `int`.
   */
  damage: z.record(z.string(), z.number().int()).default({}),
  jobType: TypeId.optional(),
  /**
   * `goodtype` — the good that IS this weapon (the craftable item a settler wields), the weapon-side
   * twin of {@link ArmorType.goodType}; resolves into the good table. **Source `goodtype 0` is the
   * natural-weapon sentinel** (a fist/claw — no craftable good backs it) and is captured as
   * `undefined`, exactly as armor class 0 / weapon `damage["0"]` mean "unarmored" — good ids start at
   * 1, so a literal 0 would dangle. This is the join that ties a forged weapon-good back to its combat
   * stats (a smithy's `sword_short` good IS the short-sword weapon).
   */
  goodType: TypeId.optional(),
  source: Provenance.optional(),
});
export type WeaponType = z.infer<typeof WeaponType>;

export const ArmorType = z.strictObject({
  /**
   * The armor's `type` id — the **armor class** a {@link WeaponType.damage} record keys against
   * (`damagevalue <armorClass> <value>`). Globally unique here (unlike {@link WeaponType.typeId}):
   * the readable `armortypes.ini` ships a flat 1..N table, not a per-tribe one. Armor class **0**
   * ("unarmored") has NO record — a weapon's `damage["0"]` is its damage against a bare target.
   */
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** `mainType` — coarse class (1 = light/cloth+leather, 2 = heavy/chain+plate in the base data). */
  mainType: ClassId.optional(),
  /** `goodtype` — the good that IS this armor (worn/carried); resolves into the good table. */
  goodType: TypeId.optional(),
  /** `materialType` — the material tier the armor is made of (cloth/leather/chain/plate = 1..4). */
  materialType: ClassId.optional(),
  /** `weight` — encumbrance the armor adds (0 = leather, up to 3 = chain/plate). */
  weight: z.number().int().nonnegative().default(0),
  /** `blockingValue` — how much incoming damage the armor mitigates (the combat read side's join key). */
  blockingValue: z.number().int().nonnegative().default(0),
  source: Provenance.optional(),
});
export type ArmorType = z.infer<typeof ArmorType>;
