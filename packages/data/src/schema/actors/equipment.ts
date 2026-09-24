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

/** A carried item's chance to multiply a landed blow's damage. */
export const EquipCriticalHit = z.strictObject({
  chancePct: z.number().int().min(1).max(100),
  damagePct: z.number().int().positive(),
});
export type EquipCriticalHit = z.infer<typeof EquipCriticalHit>;

/**
 * A good's equipment classification. The manual pins the wear split ("Partly used items (potions,
 * shoes, ...) you drop are lost", while weapons, armour and amulets "can be used again") and potion
 * `uses` ("Small potions can be used twice, large ones can be used five times"); the boots' rating is
 * the original's shoe condition. No readable `.ini` carries the other magnitudes: they are the original's
 * fixed values where known and authored balance otherwise. What boots do for the walk is not a field: the
 * original's step cost drops by a fixed two ticks while a live pair is worn (`sim` `walkStepTicks`).
 *
 * The carried effects (`damageDealtPct`, `criticalHit`, `damageTakenPct`, `walkStepTicksSaved`) act while
 * the good sits live in a misc slot. A second copy adds nothing: the original asks only whether one is
 * carried.
 */
export const EquipClass = z
  .strictObject({
    category: EquipCategory,
    /** True when the item is consumed with use (potions/shoes/tools); false for permanent gear
     *  (weapons/armour/amulets). */
    wears: z.boolean().default(false),
    /** Additive per-cycle production credit, whole percent of the recipe outputs (wooden tool 20,
     *  iron 70, the original's values). It adds to the operator's experience bonus, never multiplies it. */
    productionBonusPct: z.number().int().positive().optional(),
    /** A tool's work factor in percent (wooden 125, iron 175, the original's values): a gatherer's or
     *  fisher's strokes per unit divide by it and a builder's steps per swing multiply by it. */
    workFactorPct: z.number().int().positive().optional(),
    /** Rated uses before a wearing item breaks: one roughness point of a node walked off (boots, whose
     *  10000 is the original's shoe condition), one work event (tools: a production cycle, a gathering
     *  stroke, a cast, a build swing or a watering), or one sip (consumables). */
    uses: z.number().int().positive().optional(),
    /** What one use restores: a sip of mead or a potion, or an amulet's top-up of its need. */
    restorePct: EquipRestorePct.optional(),
    /** Percent of its damage a landed blow of the bearer deals (strength amulet 150). */
    damageDealtPct: z.number().int().positive().optional(),
    /** Rolled per landed blow of the bearer, after `damageDealtPct` (critical-hit amulet: 20% for 200%). */
    criticalHit: EquipCriticalHit.optional(),
    /** Percent of an incoming blow's damage the bearer takes, truncated (defense amulet 50). */
    damageTakenPct: z.number().int().min(0).max(100).optional(),
    /** Ticks taken off every step of the bearer's walk, before the age and weight terms (speed amulet 2). */
    walkStepTicksSaved: z.number().int().positive().optional(),
  })
  // Wear steps are ONE/uses, so a wearing item with no rated uses would never break.
  .refine((e) => !e.wears || e.uses !== undefined, {
    message: 'a wearing equip good must rate its uses',
  })
  // The sim reads the carried effects off the misc row alone; on another slot they would do nothing.
  .refine(
    (e) =>
      e.category === 'misc' ||
      (e.damageDealtPct === undefined &&
        e.criticalHit === undefined &&
        e.damageTakenPct === undefined &&
        e.walkStepTicksSaved === undefined),
    { message: 'a carried effect belongs on a misc good' },
  )
  // A permanent good may top up hunger or fatigue (the amulets do), but a wounded bearer would drink a
  // healing one forever.
  .refine((e) => e.restorePct?.healthMax === undefined || e.wears, {
    message: 'a healing equip good must wear down',
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
  /** `createsmoke 1` with `smokelifetime`: the ticks the smoke a landed shot raises where it comes down
   *  lingers at most. Absent when the weapon raises none (only the catapults do). */
  impactSmokeTicks: z.number().int().positive().optional(),
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
