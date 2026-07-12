import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

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
  mainType: TypeId.optional(),
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
  munitionType: TypeId.optional(),
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
  damageType: TypeId.optional(),
  minRange: z.number().int().nonnegative().default(1),
  maxRange: z.number().int().nonnegative().default(1),
  /** damageValue[targetArmorClass] -> value, as in the original weapontypes. */
  damage: z.record(z.string(), z.number()).default({}),
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
  mainType: TypeId.optional(),
  /** `goodtype` — the good that IS this armor (worn/carried); resolves into the good table. */
  goodType: TypeId.optional(),
  /** `materialType` — the material tier the armor is made of (cloth/leather/chain/plate = 1..4). */
  materialType: TypeId.optional(),
  /** `weight` — encumbrance the armor adds (0 = leather, up to 3 = chain/plate). */
  weight: z.number().int().nonnegative().default(0),
  /** `blockingValue` — how much incoming damage the armor mitigates (the combat read side's join key). */
  blockingValue: z.number().int().nonnegative().default(0),
  source: Provenance.optional(),
});
export type ArmorType = z.infer<typeof ArmorType>;

/**
 * One `[animaltype]` record from the base `Data/logic/animaltypes.ini` — the per-tribe behaviour of a
 * non-controllable creature/monster tribe (bear, wolf, boar, cow, sheep, …). Unlike every other type
 * table, an animal record keys on **`tribetype`**, not `type`: the source carries no `type` id, and an
 * animal's identity IS its owning tribe (the `Settler.tribe` cross-reference into {@link TribeType}).
 * `tribeType` is therefore the cross-ref key (validated against the tribe table). A handful of source
 * records carry no `tribetype` (a leftover/disabled stub); they are dropped at extract time since they
 * cannot resolve to a tribe.
 *
 * Captured per record:
 *   - `aggressive` / `getangry` — whether the animal attacks unprovoked / can be provoked into anger
 *     (the inputs to the civ-vs-animal aggression model the later combat slice consumes).
 *   - `angryGameTime` — how long (game ticks) an angered animal stays hostile.
 *   - `hitpoints_adult` / `hitpoints_baby` — the HP pool by life-stage (200..20000; the param the sim's
 *     `Health`-component stamp already reads — humans have no readable equivalent below the `.ini`).
 *   - the group/territory params (`maximumgroupsize`, `maximumcadaversize`, `maximumleaderdistance`,
 *     `searchforleader`, `maximumdistancetostaypoint`, `maximumdistancetobirthpoint`) — herd/leader
 *     structure for the later spawn/herding slice.
 *   - `movespeed` / `runspeed` — locomotion (the run speed of a fleeing/charging animal).
 *   - the flags `catchable` (can be tamed/captured), `warrantable`, `cannotbeattacked`, `ignorehouses`.
 * The graphics/sound/spawn extras are skipped — this is the behaviour type-table slice, not a renderer.
 */
export const AnimalType = z.strictObject({
  /** Slug of `name`/comment when present, else `animal_<tribeType>`. Not a cross-ref key — `tribeType` is. */
  id: z.string(),
  name: z.string().optional(),
  /** Owning tribe (`animaltype` `tribetype`) — the cross-ref into {@link TribeType}, and the record key. */
  tribeType: TypeId,
  /** `aggressive` — attacks civilizations unprovoked (the civ-vs-animal aggression driver). */
  aggressive: z.boolean().default(false),
  /** `getangry` — can be provoked into hostility (vs always-passive). */
  getAngry: z.boolean().default(false),
  /** `angryGameTime` — how long (game ticks) an angered animal stays hostile. */
  angryGameTime: z.number().int().nonnegative().default(0),
  /** `hitpoints_adult` — the adult HP pool (200..20000); the `Health`-stamp source for animal combatants. */
  hitpointsAdult: z.number().int().nonnegative().default(0),
  /** `hitpoints_baby` — the juvenile HP pool. Not inferred from `hitpointsAdult`; 0 when the source omits it. */
  hitpointsBaby: z.number().int().nonnegative().default(0),
  /** `maximumgroupsize` — how many of this animal form a herd/pack. */
  maximumGroupSize: z.number().int().nonnegative().default(0),
  /** `maximumcadaversize` — herd-corpse cap. */
  maximumCadaverSize: z.number().int().nonnegative().default(0),
  /** `maximumleaderdistance` — how far a member roams from its herd leader. */
  maximumLeaderDistance: z.number().int().nonnegative().default(0),
  /** `searchforleader` — whether a member seeks a leader to follow (herd animals) vs roams solo. */
  searchForLeader: z.boolean().default(false),
  /** `maximumdistancetostaypoint` — territory radius around the animal's stay point. */
  maximumDistanceToStayPoint: z.number().int().nonnegative().default(0),
  /** `maximumdistancetobirthpoint` — how far the herd ranges from its birth/spawn point. */
  maximumDistanceToBirthPoint: z.number().int().nonnegative().default(0),
  /** `movespeed` — walking speed (0 = the source default). */
  moveSpeed: z.number().int().nonnegative().default(0),
  /** `runspeed` — running speed (a fleeing/charging animal); 0 when the source omits it. */
  runSpeed: z.number().int().nonnegative().default(0),
  /** `catchable` — can be tamed/captured by a hunter (cows/sheep) vs wild-only. */
  catchable: z.boolean().default(false),
  /** `warrantable` — can be claimed/owned (livestock vs wildlife). */
  warrantable: z.boolean().default(false),
  /** `cannotbeattacked` — immune to civ attacks (bees/decorative fauna). */
  cannotBeAttacked: z.boolean().default(false),
  /** `ignorehouses` — pathing ignores buildings (it walks through/over them). */
  ignoreHouses: z.boolean().default(false),
  source: Provenance.optional(),
});
export type AnimalType = z.infer<typeof AnimalType>;

export const VehicleType = z.strictObject({
  /** `vehicletype` `type` — the `logicvehicletype` namespace (1..N) the `jobEnablesVehicle` tech-graph
   *  edges and a `vehicle` building's `logicvehicletype` cross-reference into. */
  typeId: TypeId,
  /** Slug of `name`. Not unique — the real data ships two `oxcart` records (types 6 and 2) that slug
   *  alike; resolve a vehicle by `typeId` (the cross-ref key), not `id`, as with {@link WeaponType}. */
  id: z.string(),
  name: z.string().optional(),
  /**
   * `stockslots` — how many goods units the vehicle can haul at once: the carrier's carry capacity
   * (handcart 15, oxcart 30, ship small 50, ship big 200; the catapult carries 0). The sim's
   * `carrierCarryCapacity` (sim's `systems/progression.ts`) consumes this — a carrier hauls a batch up
   * to the largest `stockSlots` among its tribe's unlocked vehicles, not a single unit. Defaults 0 (no
   * record observed without it).
   */
  stockSlots: z.number().int().nonnegative().default(0),
  /** `passengerslots` — how many settlers can ride (ships carry 9/19; carts and the catapult carry 0). */
  passengerSlots: z.number().int().nonnegative().default(0),
  /** `logicsize` — the vehicle's footprint/size class (0 = land cart, 1 = catapult, 2 = ship). */
  logicSize: z.number().int().nonnegative().default(0),
  /**
   * `logicgood` allow-list — the `goodtype` ids this vehicle's hold may carry, in file order. A
   * repeated single-value key (one `logicgood N` per line). The carts and both ships enumerate the
   * full haulable-goods set; the catapult lists none (it carries no cargo). This is the "WHAT a
   * boat-as-mobile-store can hold" cargo filter the Sea/Northland slice consumes — distinct from
   * {@link stockSlots} (how *much* it holds). Empty when the section lists no `logicgood`.
   */
  cargoGoods: z.array(TypeId).default([]),
  source: Provenance.optional(),
});
export type VehicleType = z.infer<typeof VehicleType>;
