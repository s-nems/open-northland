import type { WeaponType } from '@open-northland/data';
import { Armor, CurrentAtomic, type SettlerIdentity } from '../../components/index.js';
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

// The combat weapon layer — resolve what an attacker fights with (the worn / (tribe, job) /
// animal-tribe weapon and its clamped reach band), which armor material a target presents, and the
// swing itself (the `attack` CurrentAtomic carrying the pre-resolved damage).

/**
 * The weapon an attacker of `tribe`/`jobType` fights with, resolved from content: its reach as a
 * `[minRange, maxRange]` band (Manhattan half-cell nodes; see {@link withReach}) and the {@link WeaponType}
 * itself, so the caller can select the damage column for the target's armor material
 * ({@link weaponDamageVsMaterial}) and read the weapon class for fight XP. Null when no weapon resolves (an
 * unarmed combatant does no damage, the approximated stance).
 *
 * `minRange` is the near reach a ranged weapon can't fire below (the original's `hunter_bow` is
 * `minimumrange 3, maximumrange 17`, verified in the mod's `DataCnmd/types/weapons.ini`); a melee weapon is
 * `minRange 1`. A target sharing the attacker's node (distance 0) is below every weapon's near reach and is
 * not hit — only a concern when herd scatter stacks entities on one node.
 *
 * Three resolution paths, the worn override taking precedence:
 *
 *  - An explicitly-equipped combatant (`wornWeaponTypeId` set) → the {@link WeaponType} matching its own
 *    tribe + that `typeId`, overriding the `(tribe, jobType)` default. A worn id that resolves to no record
 *    leaves it unarmed for the tick rather than falling back to the default.
 *  - A settler with a `jobType` (a civilization soldier/hunter) → the {@link WeaponType} whose `tribeType`
 *    matches the attacker's tribe and whose `jobType` matches its job.
 *  - A jobless animal (`jobType === null` on a {@link isAnimalTribe} tribe, what `spawnAnimalHerd` places)
 *    → the tribe's weapon keyed by `tribeType` alone; an animal's combat identity is its tribe (each animal
 *    tribe carries one attack weapon at `typeId 1`), and the weapon's `jobType` is a monster combat-class,
 *    not a job it could match on.
 *
 * Resolved through the {@link contentIndex} weapon tables, first-wins per key on duplicate rows (the same
 * stable choice the old linear scans made).
 */
export function attackerWeapon(
  ctx: SystemContext,
  tribe: number,
  jobType: number | null,
  wornWeaponTypeId?: number,
): { minRange: number; maxRange: number; weapon: WeaponType } | null {
  const index = contentIndex(ctx.content);
  // Worn weapon (own tribe + typeId) overrides the class default; an unresolved worn id leaves it unarmed.
  if (wornWeaponTypeId !== undefined) {
    const worn = index.weaponsByTribeAndTypeId.get(tribe)?.get(wornWeaponTypeId);
    return worn === undefined ? null : withReach(worn);
  }
  // A jobless combatant is armed only if it's an animal tribe (weapon keyed by tribe); a jobless civilian
  // is unarmed.
  if (jobType === null) {
    if (!isAnimalTribe(ctx.content, tribe)) return null;
    const weapon = index.firstWeaponByTribe.get(tribe);
    return weapon === undefined ? null : withReach(weapon);
  }
  // A settler's weapon binds by (tribe, job), first match in source order.
  const weapon = index.weaponsByTribeAndJob.get(tribe)?.get(jobType);
  if (weapon === undefined) return null; // unarmed — no resolvable weapon
  return withReach(weapon);
}

/** Resolve a {@link WeaponType}'s reach band, clamped sane (`1 ≤ minRange ≤ maxRange`): `maxRange` floored
 *  at 1 (a weapon always reaches its own node), `minRange` floored at 1 and never exceeding the far reach.
 *  Range values are consumed verbatim as half-cell (node) Manhattan distances — the original's logic grid is
 *  the half-cell lattice, so its distance params live in that space (source basis: the 2W×2H lane/placement
 *  layout; no combat-code oracle — if live-original observation later contradicts this, scale here). */
function withReach(weapon: WeaponType): { minRange: number; maxRange: number; weapon: WeaponType } {
  const maxRange = Math.max(1, weapon.maxRange);
  const minRange = Math.min(Math.max(1, weapon.minRange), maxRange);
  return { minRange, maxRange, weapon };
}

/** The armor material tier a target wears — the column a weapon's `damagevalue[material]` selects. A
 *  target with an {@link Armor} tier resolves its `armorClass` to a material via
 *  {@link armorMaterialForClass}; one with no `Armor` (every animal, every bare settler) is unarmored,
 *  material 0. The `weaponDamageVsMaterial` join reads that column verbatim — no mitigation is subtracted. */
export function targetMaterial(world: World, ctx: SystemContext, target: Entity): number {
  const armor = world.tryGet(target, Armor);
  if (armor === undefined) return ARMOR_MATERIAL.NONE; // bare target — the unarmored column
  return armorMaterialForClass(ctx.content, armor.armorClass);
}

/** Start an `attack` {@link CurrentAtomic} on `attacker` against `target`, carrying the pre-resolved
 *  column `damage` (the AtomicSystem's `attack` hit subtracts it from the target's hitpoints). `duration`
 *  is the attack animation's length via the attacker's `setatomic` binding, and the swing repeats at that
 *  cadence. `hitAt` is the animation's attack-event frame (the blow lands mid-animation), omitted when the
 *  animation has no such event (the executor falls back to completion). `weaponMainType` is stamped so the
 *  swing accrues fight XP into that weapon's bucket, omitted when the weapon lists no `mainType`. */
export function startAttack(
  world: World,
  ctx: SystemContext,
  attacker: SettlerIdentity,
  e: Entity,
  target: Entity,
  damage: number,
  weapon: WeaponType,
): void {
  // Resolve the attack animation name once, then read both its duration and attack-event hit-frame off
  // that single lookup.
  const animation = atomicAnimationName(ctx.content, attacker, ATTACK_ATOMIC_ID);
  const hitAt =
    animation === undefined ? undefined : atomicEventFrame(ctx.content, animation, ATOMIC_EVENT_TYPE_ATTACK);
  // A ranged weapon (`munitiontype` present) with a positive travel `speed` fires a projectile at the
  // release frame instead of landing the blow in place; the payload rides on the `attack` effect so the
  // executor launches it at `hitAt`. A melee weapon (or a ranged one missing its `speed`) falls back to
  // the in-place hit (no `projectile` key).
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
      // Omit an absent hit-frame / mainType / projectile so the effect carries no `undefined`-valued keys —
      // the fallback-to-completion, no-XP, and melee-hit paths are the field's absence, not a sentinel.
      ...(hitAt !== undefined ? { hitAt } : {}),
      ...(weapon.mainType !== undefined ? { weaponMainType: weapon.mainType } : {}),
      // A melee swing carries the weapon's reach so the executor can re-check it at the hit frame and whiff
      // if the target stepped out — through the same `withReach` clamp the CombatSystem engaged with, so the
      // engage and whiff bands can't desync. A ranged swing homes via its projectile instead.
      ...(projectile === undefined ? { maxRange: withReach(weapon).maxRange } : { projectile }),
    },
    targetEntity: target,
    targetTile: null,
  });
  // The melee swoosh is announced at the strike frame by the executor (see `resolveAttackHit`), not here at
  // windup — the audible twin of a bow's release `projectileLaunched`, kept in sync with the visible strike.
}

/**
 * The numeric atomic id a combatant runs to attack — the original's `setatomic <job> 81 "..._attack"`
 * (id 81 is the attack slot across every fighting job's bindings; e.g. `viking_soldier_attack_*`,
 * `viking_hunter_attack` — verified in `DataCnmd/tribetypes12/tribetypes.ini`). Like the other atomic
 * ids it is the content cross-reference / animation join key; the typed `attack` effect is the behavior
 * (drain the target's hitpoints, AtomicSystem).
 */
const ATTACK_ATOMIC_ID = 81;
