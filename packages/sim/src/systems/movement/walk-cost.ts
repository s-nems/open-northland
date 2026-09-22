import type { ContentSet } from '@open-northland/data';
import {
  Armor,
  Carrying,
  Equipment,
  MISSION_BEHAVIOUR,
  MissionBehaviour,
  Settler,
  Weapon,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { type AgeClass, ageClassOfJobId } from '../lifecycle/ageclass.js';
import { NEED_DRIVE_THRESHOLD } from '../lifecycle/needs/scale.js';
import { isHeroJob } from '../readviews/jobs.js';

/**
 * How many ticks a human's step from one lattice node to the next takes, the original's per-step move
 * cost. Original behavior: a step starts when the walker leaves a node,
 * reads that node's `lmpr` roughness, and completes after exactly `cost` ticks, where
 *
 *   cost = 2 * roughness + 2 + (shoes ? 0 : 2) + (carrying a good ? 1 : 0) + (stamina <= 2000 ? 2 : 0)
 *   cost = cost * 2 when the script's slow bit is set, then cost - 2 when its fast bit is set
 *   cost = max(3, cost)
 *
 * Before script flags: subtract the tribe/job reduction, double for a baby or add two for a child,
 * then add floor(combined equipment weight / 2), except for heroes. Byte evidence
 * confirms that order. Speed amulets remain unimplemented (see amulet ticket).
 * Turning is paced separately; navigation still chooses this sim's routes, not the original's paths.
 */
export function walkStepTicks(roughness: number, m: WalkStepModifiers): number {
  let cost =
    ROUGHNESS_TICKS_PER_LEVEL * roughness +
    BASE_STEP_TICKS +
    (m.shoes ? 0 : BAREFOOT_STEP_TICKS) +
    (m.carrying ? CARRYING_STEP_TICKS : 0) +
    (m.tired ? TIRED_STEP_TICKS : 0);
  cost -= m.tribeReduction;
  if (m.age === 'baby') cost *= 2;
  else if (m.age === 'child') cost += 2;
  cost += Math.floor(m.equipmentWeight / 2);
  if (m.walksSlowly) cost *= SCRIPT_SLOW_FACTOR;
  if (m.walksFast) cost -= SCRIPT_FAST_TICKS;
  return cost < MIN_STEP_TICKS ? MIN_STEP_TICKS : cost;
}

/** The per-step state {@link walkStepTicks} paces by, read once when the step starts. */
export interface WalkStepModifiers {
  /** A live (unspent) pair of boots in the boots slot. */
  readonly shoes: boolean;
  /** Hauling a good. */
  readonly carrying: boolean;
  /** Fatigue at or past the drive level, the stamina the original tests against 2000. */
  readonly tired: boolean;
  readonly walksSlowly: boolean;
  readonly walksFast: boolean;
  readonly age: AgeClass;
  readonly tribeReduction: number;
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
/** The engine's floor on any step cost. */
export const MIN_STEP_TICKS = 3;

/** The highest roughness the owned corpus writes (`lmpr` snow). */
const ROUGHNESS_MAX_ON_MAPS = 5;

/** The longest step an ordinary human takes: barefoot, laden, due for sleep, script-slowed, off snow. */
export const MAX_STEP_TICKS = walkStepTicks(ROUGHNESS_MAX_ON_MAPS, {
  shoes: false,
  carrying: true,
  tired: true,
  walksSlowly: true,
  walksFast: false,
  age: 'adult',
  tribeReduction: 0,
  equipmentWeight: 0,
});

/** The modifiers of an ordinary walker with nothing on: the one every test map's default step reads. */
export const UNMODIFIED_STEP: WalkStepModifiers = {
  shoes: false,
  carrying: false,
  tired: false,
  walksSlowly: false,
  walksFast: false,
  age: 'adult',
  tribeReduction: 0,
  equipmentWeight: 0,
};

/** Whether `e` wears a live pair of boots: a boots slot holding a good not yet worn to ONE. The original's
 *  `HasEquippedShoes` reads the same two facts, a shoe type set and a condition above zero. */
export function hasLiveBoots(world: World, e: Entity): boolean {
  const boots = world.tryGet(e, Equipment)?.boots ?? null;
  return boots !== null && boots.degreeOfUse < ONE;
}

/** Whether `e` hauls a good, the original's carried-good-type field being non-zero. */
export function isCarryingGood(world: World, e: Entity): boolean {
  return world.has(e, Carrying);
}

/** Read `e`'s step modifiers for the step about to start. */
export function walkStepModifiersOf(world: World, e: Entity, content: ContentSet): WalkStepModifiers {
  const flags = world.tryGet(e, MissionBehaviour)?.flags ?? 0;
  const settler = world.tryGet(e, Settler);
  const fatigue = settler?.fatigue;
  const index = contentIndex(content);
  const job = settler?.jobType ?? null;
  const reduction = settler === undefined ? undefined : index.tribes.get(settler.tribe)?.walkStepReduction;
  return {
    shoes: hasLiveBoots(world, e),
    carrying: isCarryingGood(world, e),
    tired: fatigue !== undefined && fatigue >= NEED_DRIVE_THRESHOLD,
    walksSlowly: (flags & MISSION_BEHAVIOUR.WALKS_SLOWLY) !== 0,
    walksFast: (flags & MISSION_BEHAVIOUR.WALKS_FAST) !== 0,
    age: ageClassOfJobId(job === null ? undefined : index.jobs.get(job)?.id),
    tribeReduction:
      reduction !== undefined && (reduction.jobType === undefined || reduction.jobType === job)
        ? reduction.ticks
        : 0,
    equipmentWeight:
      settler === undefined || isHeroJob(content, job)
        ? 0
        : equipmentWeight(world, e, content, settler.tribe, job),
  };
}

function equipmentWeight(
  world: World,
  e: Entity,
  content: ContentSet,
  tribe: number,
  job: number | null,
): number {
  const index = contentIndex(content);
  const equipment = world.tryGet(e, Equipment);
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
  const armorClass = world.tryGet(e, Armor)?.armorClass;
  const armor =
    equipment?.armor != null
      ? index.armorByGoodType.get(equipment.armor.goodType)
      : armorClass === undefined
        ? undefined
        : index.armor.get(armorClass);
  return (weapon?.weight ?? 0) + (armor?.weight ?? 0);
}
