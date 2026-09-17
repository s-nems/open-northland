import type { WeaponType } from '@open-northland/data';
import { Armor, Building, CurrentAtomic, Equipment, type SettlerIdentity } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { atomicDurationForName, boundAtomicAnimation } from '../readviews/animations.js';
import {
  ARMOR_MATERIAL,
  ATOMIC_EVENT_TYPE_ATTACK,
  armorMaterialForClass,
  armorMaterialForGood,
  atomicEventFrame,
  isAnimalTribe,
  isRangedWeapon,
} from '../readviews/index.js';

// The combat weapon layer: what an attacker fights with, which armor material a target presents, and the
// swing itself.

/**
 * The weapon an attacker of `tribe`/`jobType` fights with, resolved from content: its reach as a
 * `[minRange, maxRange]` band (Manhattan half-cell nodes) and the {@link WeaponType} itself. Null when no
 * weapon resolves - an unarmed combatant does no damage (approximation).
 *
 * `minRange` is the near reach a ranged weapon can't fire below (the original's `hunter_bow` is
 * `minimumrange 3, maximumrange 17`, verified in the mod's `DataCnmd/types/weapons.ini`); a melee weapon is
 * `minRange 1`. A target sharing the attacker's node (distance 0) is below every weapon's near reach and is
 * not hit.
 *
 * An animal's combat identity is its tribe: a jobless animal keys by `tribeType` alone, because the
 * weapon's `jobType` is a monster combat-class rather than a job it could match on. Duplicate rows resolve
 * first-wins per key.
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
  if (weapon === undefined) return null; // unarmed - no resolvable weapon
  return withReach(weapon);
}

/** Resolve a {@link WeaponType}'s reach band, clamped sane (`1 ≤ minRange ≤ maxRange`). Range values are
 *  consumed verbatim as half-cell (node) Manhattan distances - the original's logic grid is the half-cell
 *  lattice, so its distance params live in that space (source basis: the 2W×2H lane/placement layout, no
 *  combat-code oracle). */
function withReach(weapon: WeaponType): { minRange: number; maxRange: number; weapon: WeaponType } {
  const maxRange = Math.max(1, weapon.maxRange);
  const minRange = Math.min(Math.max(1, weapon.minRange), maxRange);
  return { minRange, maxRange, weapon };
}

/** The armor material tier a target presents: the column a weapon's `damagevalue[material]` selects
 *  verbatim, with no mitigation subtracted. A worn `Equipment.armor` good overrides a scene-stamped
 *  {@link Armor} tier without falling back to it, and protects regardless of `degreeOfUse` (armor never
 *  wears). */
export function targetMaterial(world: World, ctx: SystemContext, target: Entity): number {
  if (world.has(target, Building)) return ARMOR_MATERIAL.HOUSE; // vs-building damage column
  const worn = world.tryGet(target, Equipment)?.armor;
  if (worn != null) return armorMaterialForGood(ctx.content, worn.goodType) ?? ARMOR_MATERIAL.NONE;
  const armor = world.tryGet(target, Armor);
  if (armor === undefined) return ARMOR_MATERIAL.NONE; // bare target - the unarmored column
  return armorMaterialForClass(ctx.content, armor.armorClass);
}

/** What one landed blow of a weapon does to a target of one armor material: the resolved damage column
 *  and the `soundtype_Hit` group id it plays, `undefined` when the weapon lists none for that material. */
export interface Blow {
  readonly damage: number;
  readonly hitSoundType: number | undefined;
}

/** The sound-bank group id `weapon` plays landing on a target of armor `material`, or undefined when its
 *  `soundtype_Hit` table has no entry there (the original then plays nothing). */
export function hitSoundVsMaterial(
  weapon: Pick<WeaponType, 'hitSounds'>,
  material: number,
): number | undefined {
  return weapon.hitSounds[String(material)];
}

/** Start an `attack` {@link CurrentAtomic} on `attacker` against `target`, carrying the pre-resolved
 *  `blow`. `duration` is the attack animation's length via the attacker's `setatomic` binding, and the
 *  swing repeats at that cadence; `hitAt` is the animation's attack-event frame, so the blow lands
 *  mid-animation. */
export function startAttack(
  world: World,
  ctx: SystemContext,
  attacker: SettlerIdentity,
  e: Entity,
  target: Entity,
  blow: Blow,
  weapon: WeaponType,
): void {
  const animation = boundAtomicAnimation(ctx.content, attacker, ATTACK_ATOMIC_ID);
  const hitAt =
    animation === undefined ? undefined : atomicEventFrame(ctx.content, animation, ATOMIC_EVENT_TYPE_ATTACK);
  // A ranged weapon with a positive travel `speed` fires a projectile at the release frame instead of
  // landing the blow in place; a melee weapon, or a ranged one missing its `speed`, falls back to the
  // in-place hit.
  const projectile =
    isRangedWeapon(weapon) &&
    weapon.speed !== undefined &&
    weapon.speed > 0 &&
    weapon.munitionType !== undefined
      ? // Copied: saved state may not alias the content row another swing carries too.
        { munitionType: weapon.munitionType, speed: weapon.speed, missSounds: { ...weapon.missSounds } }
      : undefined;
  world.add(e, CurrentAtomic, {
    atomicId: ATTACK_ATOMIC_ID,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: atomicDurationForName(ctx.content, animation),
    effect: {
      kind: 'attack',
      target,
      damage: blow.damage,
      // The fallback-to-completion, no-XP, silent-hit and melee-hit paths are a field's absence, not a
      // sentinel.
      ...(hitAt !== undefined ? { hitAt } : {}),
      ...(weapon.mainType !== undefined ? { weaponMainType: weapon.mainType } : {}),
      ...(blow.hitSoundType !== undefined ? { hitSoundType: blow.hitSoundType } : {}),
      // A melee swing carries the weapon's reach so the executor can whiff at the hit frame if the target
      // stepped out - through the same `withReach` clamp the engage band used, so the two cannot desync.
      ...(projectile === undefined ? { maxRange: withReach(weapon).maxRange } : { projectile }),
    },
    targetEntity: target,
    targetTile: null,
  });
  // The melee swoosh is announced at the strike frame by the executor, not here at windup, so it stays in
  // sync with the visible strike.
}

/**
 * The numeric atomic id a combatant runs to attack - the original's `setatomic <job> 81 "..._attack"`
 * (id 81 is the attack slot across every fighting job's bindings, verified in
 * `DataCnmd/tribetypes12/tribetypes.ini`). It is the content join key; the typed `attack` effect carries
 * the behavior.
 */
const ATTACK_ATOMIC_ID = 81;
