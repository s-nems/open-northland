import { z } from 'zod';
import { ClassId, Provenance, TypeId } from '../record.js';

/**
 * The slot kind a good occupies when a Viking carries it. The original's equippable goods are
 * `goodtypes.ini` ids 30-55, the set each tribe's `allowequip` list in `tribetypes.ini` names.
 */
export const EQUIP_CATEGORIES = ['boots', 'tool', 'weapon', 'armor', 'misc'] as const;
export const EquipCategory = z.enum(EQUIP_CATEGORIES);
export type EquipCategory = z.infer<typeof EquipCategory>;

/** What one sip of a drinkable equipment good restores, in whole percent of each bar; `healthMax` is a
 *  percent of the bearer's max hitpoints. */
export const EquipRestorePct = z.strictObject({
  hunger: z.number().int().min(1).max(100).optional(),
  fatigue: z.number().int().min(1).max(100).optional(),
  healthMax: z.number().int().min(1).max(100).optional(),
});
export type EquipRestorePct = z.infer<typeof EquipRestorePct>;

/**
 * A good's equipment classification. The manual pins the wear split ("Partly used items (potions,
 * shoes, ...) you drop are lost", while weapons, armour and amulets "can be used again") and potion
 * `uses` ("Small potions can be used twice, large ones can be used five times"); the boots' rating is
 * the engine's byte-verified shoe condition. Every other magnitude is authored balance: no readable
 * `.ini` carries a numeric field for it. What boots do for the walk is not a field: the engine's step
 * cost drops by a fixed two ticks while a live pair is worn (`sim` `walkStepTicks`).
 */
export const EquipClass = z
  .strictObject({
    category: EquipCategory,
    /** True when the item is consumed with use (potions/shoes/tools); false for permanent gear
     *  (weapons/armour/amulets). */
    wears: z.boolean().default(false),
    /** Additive per-cycle production credit, whole percent of the recipe outputs (wooden tool 30,
     *  iron 60). It adds to the operator's experience bonus fraction, never multiplies it. */
    productionBonusPct: z.number().int().positive().optional(),
    /** Rated uses before a wearing item breaks: one roughness point of a node walked off (boots, whose
     *  10000 is the engine's shoe condition), one completed production cycle (tools), or one sip
     *  (consumables). */
    uses: z.number().int().positive().optional(),
    /** What one sip restores - present only on drinkable goods (mead, potions). */
    restorePct: EquipRestorePct.optional(),
  })
  // Wear steps are ONE/uses, so a wearing item with no rated uses would never break.
  .refine((e) => !e.wears || e.uses !== undefined, {
    message: 'a wearing equip good must rate its uses',
  })
  // The same hole reversed: a good that restores a need without wearing is a bottomless bottle, and
  // its bearer is unkillable through the healing draught's death save.
  .refine((e) => e.restorePct === undefined || e.wears, {
    message: 'a restoring equip good must wear down',
  });
export type EquipClass = z.infer<typeof EquipClass>;

export const WeaponType = z.strictObject({
  /** The weapon's `type` id. Not globally unique: the original keys a weapon by `(tribeType, typeId)`,
   *  so the same id (e.g. 2 = "fist") recurs once per tribe. */
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** Owning tribe (`weapontype` `tribetype`). The other half of the composite key. */
  tribeType: TypeId.optional(),
  /** `mainType` - the coarse weapon class (1..7 in the base data: fist/club/sword/axe/spear/bow). */
  mainType: ClassId.optional(),
  /** `weight` - the encumbrance the weapon adds (0..2 in the base data). */
  weight: z.number().int().nonnegative().default(0),
  /** `munitiontype` - the ammunition class a ranged weapon fires (1 = arrow, 2 = catapult projectile).
   *  Absent on melee weapons, so it doubles as the data-pinned "is this weapon ranged" marker. */
  munitionType: ClassId.optional(),
  /**
   * `speed` - a ranged weapon's projectile travel speed (short/long bow 8, house bow 7, catapult 3);
   * absent on melee weapons. The extracted value is faithful but its unit is unreadable, so a consumer
   * must map it onto a per-tick step through a named calibration constant.
   */
  speed: z.number().int().nonnegative().optional(),
  /** `damagetype` - the damage class a weapon deals. Only the catapults carry it (value 2), so it reads
   *  as a siege/area marker. */
  damageType: ClassId.optional(),
  minRange: z.number().int().nonnegative().default(1),
  maxRange: z.number().int().nonnegative().default(1),
  /** `damageValue[targetArmorClass] -> value`, as in the original weapontypes. Keyed by the numeric
   *  armor {@link ClassId} in string form, since JSON object keys are strings on disk. Values are whole
   *  hit-points. */
  damage: z.record(z.string(), z.number().int()).default({}),
  /**
   * `soundtype_Hit[targetMaterial] -> LogicSoundType`: the sound-bank group id a landed blow plays,
   * keyed like {@link damage} by the victim's armor material (a house is column 7, a vehicle 6). A
   * material with no entry lands silently.
   */
  hitSounds: z.record(z.string(), z.number().int()).default({}),
  /**
   * `soundtype_NoHit[groundLogicType] -> LogicSoundType`: the group id a shot that struck nothing plays
   * where it lands, keyed by the ground's `trianglepatterntypes` logic type (1 water, 2 land, ...).
   * Only ranged rows carry it. A ground type with no entry lands silently.
   */
  missSounds: z.record(z.string(), z.number().int()).default({}),
  jobType: TypeId.optional(),
  /** `goodtype` - the good that is this weapon; resolves into the good table. Source `goodtype 0` is the
   *  natural-weapon sentinel (a fist or claw, backed by no craftable good) and is captured as
   *  `undefined`, since good ids start at 1. */
  goodType: TypeId.optional(),
  source: Provenance.optional(),
});
export type WeaponType = z.infer<typeof WeaponType>;

export const ArmorType = z.strictObject({
  /**
   * The armor's `type` id - the armor class a {@link WeaponType.damage} record keys against
   * (`damagevalue <armorClass> <value>`). Globally unique: `armortypes.ini` ships one flat 1..N table,
   * not a per-tribe one. Class 0 ("unarmored") has no record, so `damage["0"]` is damage against a bare
   * target.
   */
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** `mainType` - coarse class (1 = light/cloth+leather, 2 = heavy/chain+plate in the base data). */
  mainType: ClassId.optional(),
  /** `goodtype` - the good that is this armor (worn/carried); resolves into the good table. */
  goodType: TypeId.optional(),
  /** `materialType` - the material tier the armor is made of (cloth/leather/chain/plate = 1..4). */
  materialType: ClassId.optional(),
  /** `weight` - encumbrance the armor adds (0 = leather, up to 3 = chain/plate). */
  weight: z.number().int().nonnegative().default(0),
  /** `blockingValue` - how much incoming damage the armor mitigates. */
  blockingValue: z.number().int().nonnegative().default(0),
  source: Provenance.optional(),
});
export type ArmorType = z.infer<typeof ArmorType>;
