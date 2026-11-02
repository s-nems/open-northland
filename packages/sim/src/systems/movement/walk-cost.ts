import { type ContentSet, type UnitVariant, unitVariantFor } from '@open-northland/data';
import {
  Armor,
  bootsDegreeOfUse,
  Carrying,
  Equipment,
  type EquipmentData,
  MISSION_BEHAVIOUR,
  MissionBehaviour,
  Settler,
  SettlerNeeds,
  Weapon,
} from '../../components/index.js';
import { type ContentIndex, contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { carriedStepTicksSaved } from '../equipment/index.js';
import { type AgeClass, ageClassOfJobId } from '../lifecycle/ageclass.js';
import { needLevel } from '../lifecycle/needs/levels.js';
import { NEED_DRIVE_THRESHOLD } from '../lifecycle/needs/scale.js';
import { isHeroJob } from '../readviews/jobs.js';
import { cartDragTicks } from '../vehicles/drag.js';
import { haulingCartSpeedLossPercent } from '../vehicles/hauling-cart.js';

/**
 * How many ticks a human's step from one lattice node to the next takes, the original's per-step move
 * cost. Original behavior: a step starts when the walker leaves a node,
 * reads that node's resistance (its `lmpr` roughness, 1 on a road), and completes after exactly `cost`
 * ticks, where
 *
 *   cost = 2 * roughness + (speed amulet ? 0 : 2) + (shoes ? 0 : 2) + (carrying a good ? 1 : 0)
 *        + (stamina <= 2000 ? 2 : 0)
 *   cost = cost * 2 when the script's slow bit is set, then cost - 2 when its fast bit is set
 *   cost = max(3, cost)
 *
 * Before script flags: double for a baby or add two for a child,
 * then add floor(combined equipment weight / 2), except for heroes. The original applies
 * them in that order.
 * Turning is paced separately; navigation still chooses this sim's routes, not the original's paths.
 */
export function walkStepTicks(roughness: number, m: WalkStepModifiers): number {
  let cost =
    ROUGHNESS_TICKS_PER_LEVEL * roughness +
    BASE_STEP_TICKS -
    m.stepTicksSaved +
    (m.shoes ? 0 : BAREFOOT_STEP_TICKS) +
    (m.carrying ? CARRYING_STEP_TICKS : 0) +
    (m.tired ? TIRED_STEP_TICKS : 0);
  if (m.age === 'baby') cost *= 2;
  else if (m.age === 'child') cost += 2;
  cost += Math.floor(m.equipmentWeight / 2);
  if (m.walksSlowly) cost *= SCRIPT_SLOW_FACTOR;
  if (m.walksFast) cost -= SCRIPT_FAST_TICKS;
  cost += cartDragTicks(cost, m.cartSpeedLossPercent);
  return cost < MIN_STEP_TICKS ? MIN_STEP_TICKS : cost;
}

/** The per-step state {@link walkStepTicks} paces by, read once when the step starts. */
export interface WalkStepModifiers {
  /** A live (unspent) pair of boots in the boots slot. */
  readonly shoes: boolean;
  /** Ticks carried items take off the base step: the speed amulet's 2. */
  readonly stepTicksSaved: number;
  /** Hauling a good. */
  readonly carrying: boolean;
  /** The drag of the laden hauling cart in hand, in percent of the step (`haulingCartSpeedLossPercent`);
   *  zero on foot. */
  readonly cartSpeedLossPercent: number;
  /** Fatigue at or past the drive level, the stamina the original tests against 2000. */
  readonly tired: boolean;
  readonly walksSlowly: boolean;
  readonly walksFast: boolean;
  readonly age: AgeClass;
  /** Combined weapon/armor weight; zero for a hero. */
  readonly equipmentWeight: number;
}

const ROUGHNESS_TICKS_PER_LEVEL = 2;
const BASE_STEP_TICKS = 2;
const BAREFOOT_STEP_TICKS = 2;
const CARRYING_STEP_TICKS = 1;
const TIRED_STEP_TICKS = 2;
const SCRIPT_SLOW_FACTOR = 2;
const SCRIPT_FAST_TICKS = 2;
/** The original's floor on any step cost. */
export const MIN_STEP_TICKS = 3;

/** The highest roughness the owned corpus writes (`lmpr` snow). */
export const ROUGHNESS_MAX_ON_MAPS = 5;

/** The longest step an ordinary human takes: barefoot, laden, due for sleep, script-slowed, off snow.
 *  A hauling cart's drag lies outside it; obstruction scales by the captured leg cost anyway. */
export const MAX_STEP_TICKS = walkStepTicks(ROUGHNESS_MAX_ON_MAPS, {
  shoes: false,
  stepTicksSaved: 0,
  carrying: true,
  cartSpeedLossPercent: 0,
  tired: true,
  walksSlowly: true,
  walksFast: false,
  age: 'adult',
  equipmentWeight: 0,
});

/** The modifiers of an ordinary walker with nothing on: the one every test map's default step reads. */
export const UNMODIFIED_STEP: WalkStepModifiers = {
  shoes: false,
  stepTicksSaved: 0,
  carrying: false,
  cartSpeedLossPercent: 0,
  tired: false,
  walksSlowly: false,
  walksFast: false,
  age: 'adult',
  equipmentWeight: 0,
};

/** Whether `e` wears a live pair of boots: a boots slot holding a good not yet worn to ONE. The original
 *  checks the same two facts, a shoe type set and a condition above zero. */
export function hasLiveBoots(
  world: World,
  e: Entity,
  equipment: Readonly<EquipmentData> | undefined = world.tryGet(e, Equipment),
): boolean {
  const degreeOfUse = bootsDegreeOfUse(world, e, equipment);
  return degreeOfUse !== null && degreeOfUse < ONE;
}

/** Whether `e` hauls a good: in the original, a carried good type is set. */
export function isCarryingGood(world: World, e: Entity): boolean {
  return world.has(e, Carrying);
}

/** {@link WalkStepModifiers} a reader fills in place. */
export type WalkStepModifiersScratch = { -readonly [K in keyof WalkStepModifiers]: WalkStepModifiers[K] };

export function emptyWalkStepModifiers(): WalkStepModifiersScratch {
  return { ...UNMODIFIED_STEP };
}

/** Read `e`'s step modifiers for the step about to start into `out`, a scratch a hot caller reuses. */
export function walkStepModifiersOf(
  world: World,
  e: Entity,
  content: ContentSet,
  tick: number,
  out: WalkStepModifiersScratch = emptyWalkStepModifiers(),
): WalkStepModifiers {
  const flags = world.tryGet(e, MissionBehaviour)?.flags ?? 0;
  const settler = world.tryGet(e, Settler);
  const needs = world.tryGet(e, SettlerNeeds);
  const equipment = world.tryGet(e, Equipment);
  const fatigue = needs === undefined ? undefined : needLevel(needs, 'fatigue', tick);
  const index = contentIndex(content);
  const job = settler?.jobType ?? null;
  const variant = settler === undefined ? undefined : unitVariantFor(content, settler);
  out.shoes = equipment?.boots != null && hasLiveBoots(world, e, equipment);
  out.stepTicksSaved = equipment === undefined ? 0 : carriedStepTicksSaved(world, content, e, equipment);
  out.carrying = isCarryingGood(world, e);
  out.cartSpeedLossPercent = haulingCartSpeedLossPercent(world, content, e);
  out.tired = fatigue !== undefined && fatigue >= NEED_DRIVE_THRESHOLD;
  out.walksSlowly = (flags & MISSION_BEHAVIOUR.WALKS_SLOWLY) !== 0;
  out.walksFast = (flags & MISSION_BEHAVIOUR.WALKS_FAST) !== 0;
  out.age = ageClassOfJobId(job === null ? undefined : index.jobs.get(job)?.id);
  out.equipmentWeight =
    settler === undefined || isHeroJob(content, job)
      ? 0
      : equipmentWeight(world, e, index, equipment, settler.tribe, job, variant);
  return out;
}

function equipmentWeight(
  world: World,
  e: Entity,
  index: ContentIndex,
  equipment: Readonly<EquipmentData> | undefined,
  tribe: number,
  job: number | null,
  variant: UnitVariant | undefined,
): number {
  const weaponType = world.tryGet(e, Weapon)?.weaponTypeId;
  const classWeapon = job === null ? undefined : index.weaponsByTribeAndJob.get(tribe)?.get(job);
  // Several weapon classes share a good (sword/saber). Preserve the equipped combat identity;
  // a good lookup alone loses the class's weight. A spawned class may have no explicit Weapon yet.
  const weapon =
    weaponType !== undefined
      ? index.weaponsByTribeAndTypeId.get(tribe)?.get(weaponType)
      : equipment?.weapon == null || equipment.weapon.goodType === classWeapon?.goodType
        ? classWeapon
        : index.weaponByTribeAndGoodType.get(tribe)?.get(equipment.weapon.goodType);
  const variantWeapon =
    variant?.weapon !== undefined && (weaponType === undefined || weaponType === classWeapon?.typeId)
      ? index.weaponsByTribeAndTypeId.get(variant.weapon.tribeType)?.get(variant.weapon.typeId)
      : undefined;
  const armorClass = world.tryGet(e, Armor)?.armorClass;
  const armor =
    equipment?.armor != null
      ? index.armorByGoodType.get(equipment.armor.goodType)
      : armorClass === undefined
        ? undefined
        : index.armor.get(armorClass);
  return (variantWeapon?.weight ?? weapon?.weight ?? 0) + (armor?.weight ?? 0);
}
