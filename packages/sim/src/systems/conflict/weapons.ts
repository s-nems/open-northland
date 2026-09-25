import type { WeaponType } from '@open-northland/data';
import {
  Armor,
  addCurrentAtomic,
  Building,
  CurrentAtomic,
  Equipment,
  isWildlife,
  Palisade,
  type SettlerIdentity,
  Vehicle,
  type VehicleStateView,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
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
  isAreaWeapon,
  isRangedWeapon,
} from '../readviews/index.js';

// The combat weapon layer: what an attacker fights with, which armor material a target presents, and the
// swing itself.

/**
 * The weapon an attacker of `tribe`/`jobType` fights with, resolved from content: its reach as a
 * `[minRange, maxRange]` band (map points) and the {@link WeaponType} itself. Null when no
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

/** The vehicle's weapon: the row its type's job binds for its tribe (weapon 21 for the catapult's job
 *  54). Null for every unarmed vehicle - the carts and ships. */
export function vehicleWeapon(
  ctx: SystemContext,
  state: Pick<VehicleStateView, 'vehicleType' | 'tribe'>,
): ReturnType<typeof attackerWeapon> {
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  return type === undefined ? null : attackerWeapon(ctx, state.tribe, type.jobId);
}

/** Resolve a {@link WeaponType}'s reach band, clamped sane (`1 ≤ minRange ≤ maxRange`). Range values are
 *  consumed verbatim as map points, the hexagonal distance of `nav/halfcell.ts`. Original behavior: a
 *  target is in reach when its map-point distance lies within the band, so a reach of 1 touches the six
 *  nodes around it. */
function withReach(weapon: WeaponType): { minRange: number; maxRange: number; weapon: WeaponType } {
  const maxRange = Math.max(1, weapon.maxRange);
  const minRange = Math.min(Math.max(1, weapon.minRange), maxRange);
  return { minRange, maxRange, weapon };
}

/**
 * The armor material tier a target presents: the column a weapon's `damagevalue[material]` selects. A
 * worn `Equipment.armor` good overrides a scene-stamped {@link Armor} tier without falling back to it,
 * and protects regardless of `degreeOfUse` (armor never wears). Original behavior: a building takes the
 * house column, a vehicle the wood column and every animal the leather one, whatever the beast.
 */
export function targetMaterial(world: World, ctx: SystemContext, target: Entity): number {
  if (world.has(target, Building) || world.has(target, Palisade)) return ARMOR_MATERIAL.HOUSE;
  if (world.has(target, Vehicle)) return ARMOR_MATERIAL.VEHICLE;
  if (isWildlife(world, target)) return ARMOR_MATERIAL.LEATHER;
  const worn = world.tryGet(target, Equipment)?.armor;
  if (worn != null) return armorMaterialForGood(ctx.content, worn.goodType) ?? ARMOR_MATERIAL.NONE;
  const armor = world.tryGet(target, Armor);
  if (armor === undefined) return ARMOR_MATERIAL.NONE; // bare target - the unarmored column
  return armorMaterialForClass(ctx.content, armor.armorClass);
}

/** How much of a blow's HOUSE damage takes one valency off a wall. */
const HOUSE_DAMAGE_PER_WALL_VALENCY = 100;

/**
 * The valency a wall loses to a blow of `houseDamage`, the weapon's HOUSE column. Source basis:
 * landscapetypes.ini gives the wall and both gates `maximumValency 100` and `transition 10 ... -1`, one
 * valency per hit; original behavior: a blow lands one such hit per whole hundred, so under 100 does nothing.
 */
export function wallBlowDamage(houseDamage: number): number {
  return Math.trunc(Math.max(0, houseDamage) / HOUSE_DAMAGE_PER_WALL_VALENCY);
}

/** A blow's resolved damage against `target`: {@link wallBlowDamage} for a wall, else `damage` itself. */
export function damageVsTarget(world: World, target: Entity, damage: number): number {
  return world.has(target, Palisade) ? wallBlowDamage(damage) : damage;
}

/** Whether a blow of resolved `damage` leaves `target` untouched. Original behavior: a blow that takes no
 *  valency off a wall does nothing at all, and sounds no hit. */
export function glancesOff(world: World, target: Entity, damage: number): boolean {
  return damage <= 0 && world.has(target, Palisade);
}

/**
 * The `blockingValue` a person's armor takes off each blow, read from the same worn good or
 * {@link Armor} tier as {@link targetMaterial}; 0 without armor or an `[armortype]` record.
 */
export function targetBlocking(world: World, ctx: SystemContext, target: Entity): number {
  const index = contentIndex(ctx.content);
  const worn = world.tryGet(target, Equipment)?.armor;
  if (worn != null) return index.armorByGoodType.get(worn.goodType)?.blockingValue ?? 0;
  const armor = world.tryGet(target, Armor);
  return armor === undefined ? 0 : (index.armor.get(armor.armorClass)?.blockingValue ?? 0);
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
        {
          munitionType: weapon.munitionType,
          speed: weapon.speed,
          hitSelf: weapon.hitSelf,
          area: isAreaWeapon(weapon),
          damage: { ...weapon.damage },
          hitSounds: { ...weapon.hitSounds },
          missSounds: { ...weapon.missSounds },
        }
      : undefined;
  addCurrentAtomic(world, e, {
    atomicId: ATTACK_ATOMIC_ID,
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

/** The attack clip `attacker`'s trade binds: its length in ticks and the tick of it the shot leaves at,
 *  the clip's attack event, or its last tick when it has none. */
export function attackClipTiming(
  content: SystemContext['content'],
  attacker: SettlerIdentity,
): { readonly length: number; readonly shotAt: number } {
  const clip = boundAtomicAnimation(content, attacker, ATTACK_ATOMIC_ID);
  const length = atomicDurationForName(content, clip);
  const event = clip === undefined ? undefined : atomicEventFrame(content, clip, ATOMIC_EVENT_TYPE_ATTACK);
  return { length, shotAt: Math.min(event ?? length, length) };
}

/**
 * The numeric atomic id a combatant runs to attack - the original's `setatomic <job> 81 "..._attack"`
 * (id 81 is the attack slot across every fighting job's bindings, verified in
 * `DataCnmd/tribetypes12/tribetypes.ini`). It is the content join key; the typed `attack` effect carries
 * the behavior.
 */
const ATTACK_ATOMIC_ID = 81;
