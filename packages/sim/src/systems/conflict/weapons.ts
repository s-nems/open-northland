import type { WeaponType } from '@vinland/data';
import { Armor, CurrentAtomic } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { atomicAnimationName, atomicDurationForName } from '../readviews/animations.js';
import {
  ARMOR_MATERIAL,
  ATOMIC_EVENT_TYPE_ATTACK,
  armorMaterialForClass,
  atomicEventFrame,
  isAnimalTribe,
  isRangedWeapon,
} from '../readviews/index.js';

// The combat WEAPON layer — resolve what an attacker fights with (the worn / (tribe, job) /
// animal-tribe weapon and its clamped reach band), which armor material a target presents, and the
// swing itself (the `attack` CurrentAtomic carrying the pre-resolved damage).

/**
 * The weapon an attacker of `tribe`/`jobType` fights with, resolved from content. Returns its reach as
 * a `[minRange, maxRange]` band (Manhattan cells) and the resolved {@link WeaponType} itself, so the
 * caller can select the damage **column for the picked target's armor material**
 * ({@link weaponDamageVsMaterial}) and read the weapon's class for fight XP. Null when no weapon
 * resolves (an unarmed combatant — it does no damage, the approximated stance).
 *
 * **The reach is a band, not just a ceiling.** `maxRange` is the far reach (floored at 1, so even a
 * `maxRange 0` weapon still reaches an adjacent cell). `minRange` is the *near* reach a **ranged**
 * weapon can't fire below — the original's `hunter_bow` is `minimumrange 3, maximumrange 17` (verified
 * in the mod's `DataCnmd/types/weapons.ini`), so a bow can't hit an adjacent target; a melee weapon is
 * `minRange 1` (the common case — it hits from one cell away). Both ends are floored at 1, so a target
 * sharing the attacker's own cell (Manhattan distance 0) is below every weapon's near reach and is not
 * hit — only a real concern when the herd scatter stacks entities (entities share tiles freely). The
 * band is clamped sane (`1 ≤ minRange ≤ maxRange`) so a malformed weapon never reads as never-able-to-hit.
 *
 * Three resolution paths, mirroring how the original keys a weapon (the worn override takes precedence):
 *
 *  - **An explicitly-equipped combatant** (`wornWeaponTypeId` set — a settler carrying a {@link Weapon}) →
 *    the {@link WeaponType} matching its **own tribe + that `typeId`**, overriding the `(tribe, jobType)`
 *    default below. This is what lets one settler of a soldier-class hold a *specific* weapon from the
 *    several its class may wield (`weaponsForJob`); a worn id that resolves to no record leaves it unarmed
 *    for the tick (rather than silently falling back to the default), the "the data doesn't define it →
 *    it does nothing" stance {@link Armor} takes for an out-of-table class.
 *  - **A settler with a `jobType`** (a civilization soldier/hunter, or a bound combatant) → the
 *    {@link WeaponType} whose `tribeType` matches the attacker's tribe **and** whose `jobType` matches
 *    the attacker's job, exactly as the original binds a weapon to a *job*.
 *  - **A jobless animal** (`jobType === null` on a {@link isAnimalTribe} tribe — what `spawnAnimalHerd`
 *    places: an animal isn't born into a trade) → the tribe's weapon keyed by **`tribeType` alone**.
 *    An animal's combat identity IS its tribe (each animal tribe carries essentially one attack weapon
 *    — `claw`/`bearfist`/`wolvefist`, all at `typeId 1`); the weapon's `jobType` in the real data is the
 *    creature's monster combat-class, not a player-assignable trade, so a spawned animal can't match on
 *    job. Without this a spawned aggressive animal resolves no weapon and does no damage despite
 *    {@link mayAttack} engaging it.
 *
 * Determinism: resolved through the {@link contentIndex} weapon tables, which are built FIRST-wins
 * per `(tribeType, typeId)` / `(tribeType, jobType)` / tribe — a `(tribeType, jobType)` pair (and an
 * animal tribe's weapon set) may have more than one row, and first-in-source-order is the stable
 * choice the old linear scans made (the same determinism stance the extractor keeps and
 * {@link combatDamage} documents), so the pick is unchanged on duplicate rows.
 */
export function attackerWeapon(
  ctx: SystemContext,
  tribe: number,
  jobType: number | null,
  wornWeaponTypeId?: number,
): { minRange: number; maxRange: number; weapon: WeaponType } | null {
  const index = contentIndex(ctx.content);
  // An equipped combatant wields its WORN weapon (its own tribe + that typeId), overriding the default
  // class weapon. A worn id with no matching record leaves it unarmed for the tick (the data-doesn't-define
  // -it → does-nothing stance) rather than falling through to the default.
  if (wornWeaponTypeId !== undefined) {
    const worn = index.weaponsByTribeAndTypeId.get(tribe)?.get(wornWeaponTypeId);
    return worn === undefined ? null : withReach(worn);
  }
  // A JOBLESS combatant carries a weapon only if it is an animal tribe (whose weapon keys by tribe, not
  // job — `spawnAnimalHerd` places jobless animals); a jobless civilian is unarmed.
  if (jobType === null) {
    if (!isAnimalTribe(ctx.content, tribe)) return null;
    // A jobless animal binds its weapon by tribe alone (its combat identity IS its tribe): the tribe's
    // FIRST source-order weapon row, the record the old linear scan returned.
    const weapon = index.firstWeaponByTribe.get(tribe);
    return weapon === undefined ? null : withReach(weapon);
  }
  // A settler with a job binds its weapon by (tribe, job) — first match in source order (the index
  // tables are first-wins per pair, preserving the old array scan's pick on duplicate rows).
  const weapon = index.weaponsByTribeAndJob.get(tribe)?.get(jobType);
  if (weapon === undefined) return null; // unarmed — no resolvable weapon for this combatant
  return withReach(weapon);
}

/** Resolve a {@link WeaponType}'s reach band, clamped sane (`1 ≤ minRange ≤ maxRange`): `maxRange` floored
 *  at 1 (a weapon always reaches at least its own node), `minRange` floored at 1 and never exceeding the
 *  far reach, so a malformed band can't read as "can never hit". A ranged weapon (the hunter's bow) keeps
 *  its `minRange > 1` near floor — it can't fire on an adjacent target. The extracted range values are
 *  consumed VERBATIM as half-cell (node) Manhattan distances — the same reading as the footprint offsets:
 *  the original's logic grid IS the half-cell lattice, so its distance params live in that space (source
 *  basis: the 2W×2H lane/placement layout; no combat-code oracle — if live-original observation later
 *  contradicts this, scale here). */
function withReach(weapon: WeaponType): { minRange: number; maxRange: number; weapon: WeaponType } {
  const maxRange = Math.max(1, weapon.maxRange);
  const minRange = Math.min(Math.max(1, weapon.minRange), maxRange);
  return { minRange, maxRange, weapon };
}

/** The armor **material tier** a target wears — the column a weapon's `damagevalue[material]` selects.
 *  A target with an {@link Armor} tier resolves its `armorClass` to a material via
 *  {@link armorMaterialForClass} (== the class for the four base armors); one with **no** `Armor` (every
 *  animal, every bare settler) is unarmored, material **0**. The `weaponDamageVsMaterial` join reads that
 *  column verbatim — no mitigation is subtracted. */
export function targetMaterial(world: World, ctx: SystemContext, target: Entity): number {
  const armor = world.tryGet(target, Armor);
  if (armor === undefined) return ARMOR_MATERIAL.NONE; // bare target — the unarmored column
  return armorMaterialForClass(ctx.content, armor.armorClass);
}

/** Start an `attack` {@link CurrentAtomic} on `attacker` against `target`, carrying the pre-resolved
 *  column `damage` (the AtomicSystem's `attack` hit just subtracts it from the target's hitpoints).
 *  `duration` is the attack animation's length, resolved through the attacker's `setatomic` binding
 *  like every other atomic (`atomicDuration`), and the swing REPEATS at that cadence — a survivor is
 *  re-targeted next idle tick and swings again. `hitAt` is the animation's ATTACK-event frame (the blow
 *  lands mid-animation, not at completion); it is omitted when the animation has no such event (the
 *  executor then falls back to completion). `weaponMainType` (the weapon's coarse class) is stamped so
 *  the swing accrues fight XP into that weapon's bucket; omitted when the weapon lists no `mainType`.
 *  `targetEntity` records the object for render/inspection. */
export function startAttack(
  world: World,
  ctx: SystemContext,
  attacker: { tribe: number; jobType: number | null },
  e: Entity,
  target: Entity,
  damage: number,
  weapon: WeaponType,
): void {
  // Resolve the attack animation NAME once (the tribe's `setatomic 81` walk), then read BOTH its
  // duration and its ATTACK-event hit-frame off that single resolution — the swing-start is per-swing,
  // not per-tick, but re-walking the bindings twice for the same animation is a needless hot-loop cost.
  const animation = atomicAnimationName(ctx.content, attacker, ATTACK_ATOMIC_ID);
  const hitAt =
    animation === undefined ? undefined : atomicEventFrame(ctx.content, animation, ATOMIC_EVENT_TYPE_ATTACK);
  // A RANGED weapon (a bow/catapult — `munitiontype` present) with a positive travel `speed` fires a
  // PROJECTILE at the release frame instead of landing the blow in place. The `projectile` payload rides
  // on the `attack` effect so the executor launches it at `hitAt`; a ranged weapon missing its `speed`
  // (malformed content) or a melee weapon falls back to the in-place hit (no `projectile` key).
  const projectile =
    isRangedWeapon(weapon) &&
    weapon.speed !== undefined &&
    weapon.speed > 0 &&
    weapon.munitionType !== undefined
      ? { munitionType: weapon.munitionType, speed: weapon.speed }
      : undefined;
  world.add(e, CurrentAtomic, {
    atomicId: ATTACK_ATOMIC_ID,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: atomicDurationForName(ctx.content, animation),
    effect: {
      kind: 'attack',
      target,
      damage,
      // Omit an absent hit-frame / mainType / projectile so a melee weapon+animation that carries none
      // yields the exact `{ kind, target, damage }` effect (no `undefined`-valued keys) — the
      // fallback-to-completion, no-XP, and melee-hit paths are the absence of the field, not a sentinel.
      ...(hitAt !== undefined ? { hitAt } : {}),
      ...(weapon.mainType !== undefined ? { weaponMainType: weapon.mainType } : {}),
      ...(projectile !== undefined ? { projectile } : {}),
    },
    targetEntity: target,
    targetTile: null,
  });
}

/**
 * The numeric atomic id a combatant runs to attack — the original's `setatomic <job> 81 "..._attack"`
 * (id 81 is the attack slot across every fighting job's bindings; e.g. `viking_soldier_attack_*`,
 * `viking_hunter_attack` — verified in `DataCnmd/tribetypes12/tribetypes.ini`). Like the other atomic
 * ids it is the content cross-reference / animation join key; the typed `attack` effect is the behavior
 * (drain the target's hitpoints, AtomicSystem).
 */
const ATTACK_ATOMIC_ID = 81;
