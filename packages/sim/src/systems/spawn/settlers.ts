import type { ContentSet } from '@open-northland/data';
import {
  Age,
  Armor,
  addPerson,
  Equipment,
  type EquipmentSlot,
  Female,
  Health,
  MISC_EQUIP_SLOTS,
  MoveSpeed,
  nameHuman,
  Owner,
  Position,
  stampMissionBehaviour,
  stampMissionId,
  stampOwner,
  Weapon,
  WorkFlag,
} from '../../components/index.js';
import type { Command, SettlerEquipment, SettlerEquipmentSlot } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import { fx, ONE } from '../../core/fixed.js';
import type { Rng } from '../../core/rng.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { jobCanHarvestGood, syncWorkFlagToJob } from '../economy/work-flag.js';
import { isFemaleJobId } from '../family/eligibility.js';
import { spawnAgeTicks } from '../lifecycle/ageclass.js';
import { rollInitialNeed } from '../lifecycle/needs/index.js';
import { evictSettlerFromBlockedSpawn } from '../movement/evict.js';
import { stampDefaultStance } from '../orders/index.js';
import {
  isAnimalTribe,
  isHeroJob,
  isSoldierJob,
  mayChangeEquipment,
  settlerHitpoints,
} from '../readviews/index.js';
import { attachAuthoredBuildings, attachAuthoredVehicle } from './attach.js';

/**
 * The data of a settler to create: the `spawnSettler` command payload minus its `kind`, so a scene's direct
 * pre-tick-0 placement and the runtime command share one entity-assembly path. `x`/`y` are half-cell node
 * coords, like every sim command. The authored attachment anchors are absent because binding a settler to
 * a standing building is the runtime seam's work, not entity assembly.
 */
export type SettlerSpec = Omit<
  Extract<Command, { kind: 'spawnSettler' }>,
  'kind' | 'home' | 'workplace' | 'vehicle'
>;

/**
 * The hitpoint pool a settler carries before its tribe's adult pool applies: every baby and child, and an
 * adult whose tribe declares no pool. An authored fallback scale; the child-to-adult ratio it implies is
 * uncalibrated.
 */
export const DEFAULT_SETTLER_HITPOINTS = 300;

/** The idle/unemployed job sentinel: the command wire form of `jobType: null`, since a command field cannot
 *  carry null. Valid on any content, including one whose job table starts at typeId 1. */
const IDLE_JOB_TYPE = 0;

/**
 * Assemble a settler entity from a {@link SettlerSpec}, or return null for an unknown job id or an animal
 * tribe. Shared by the `spawnSettler` command handler and the sanctioned pre-tick-0 scene helpers; it emits
 * no event, because the birth event belongs to the runtime seam only.
 *
 * Stamp set and order are hash-significant. It draws four values from `rng` to seed the starting needs
 * ({@link rollInitialNeed}) in the order hunger, fatigue, piety, enjoyment, which is part of the
 * deterministic RNG stream.
 */
export function createSettler(world: World, content: ContentSet, rng: Rng, spec: SettlerSpec): Entity | null {
  if (spec.jobType !== IDLE_JOB_TYPE && !contentIndex(content).commandJobs.has(spec.jobType)) return null;
  // This path mints a person, so an animal tribe is bad input: creatures come from `spawnAnimalHerd`,
  // and a `Person` on one is the exact state the personhood invariant rejects.
  if (isAnimalTribe(content, spec.tribe)) return null;

  const e = world.create();
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  addPerson(
    world,
    e,
    {
      tribe: spec.tribe,
      jobType: spec.jobType === IDLE_JOB_TYPE ? null : spec.jobType,
      hunger: rollInitialNeed(rng),
      fatigue: rollInitialNeed(rng),
      piety: rollInitialNeed(rng),
      enjoyment: rollInitialNeed(rng),
    },
    {
      // The map hashes in sorted-key order, so a spawned veteran's starting XP is order-independent.
      experience: new Map<number, number>(spec.experience ?? []),
    },
  );
  // Sex is explicit because `jobType` loses it on adult trades: the sex-tagged job slugs stamp it at
  // creation and every other spawn is male. Matched by the job's `id` slug, not its numeric id, because a
  // fixture's adult trade may reuse a low id.
  const jobId = contentIndex(content).commandJobs.get(spec.jobType)?.id;
  if (isFemaleJobId(jobId)) {
    world.add(e, Female, { female: true });
  }
  // A settler spawned directly into a baby/child job (an authored map's `sethuman` children) starts at its
  // stage's tick like a born baby; `Age` is what makes the GrowthSystem mature it. Slug-matched, like
  // `Female` above.
  const ageTicks = spawnAgeTicks(jobId);
  if (ageTicks !== null) {
    world.add(e, Age, { ticks: ageTicks });
  }
  // An adult takes its tribe's pool ({@link settlerHitpoints}), so every adult spawn on one content base
  // shares one value; a young stage keeps the childhood default and grows into the tribe pool. An explicit
  // positive `hitpoints` wins over both.
  const young = ageTicks !== null;
  const override = spec.hitpoints !== undefined && spec.hitpoints > 0 ? spec.hitpoints : undefined;
  const tribeHitpoints = settlerHitpoints(content, spec.tribe);
  const adultPool = tribeHitpoints > 0 ? tribeHitpoints : DEFAULT_SETTLER_HITPOINTS;
  const hitpoints = override ?? (young ? DEFAULT_SETTLER_HITPOINTS : adultPool);
  world.add(e, Health, { hitpoints, max: hitpoints });
  const heroJob = isHeroJob(content, spec.jobType);
  const fixedHeroArmor = heroJob ? contentIndex(content).jobs.get(spec.jobType)?.fixedArmorType : undefined;
  const armorClass = fixedHeroArmor ?? spec.armorClass;
  if (armorClass !== undefined && armorClass > 0) {
    world.add(e, Armor, { armorClass });
  }
  if (spec.weaponTypeId !== undefined && spec.weaponTypeId > 0) {
    world.add(e, Weapon, { weaponTypeId: spec.weaponTypeId });
  }
  // A hero's weapon and armor are part of the authored class, not player-controlled inventory. Resolve
  // the weapon from the same (tribe, job) record combat uses and the armor good from the fixed armor type,
  // so map placement, mission `sethuman` and admin spawning all produce the same permanent loadout.
  const fixedHeroWeapon = heroJob
    ? contentIndex(content).weaponsByTribeAndJob.get(spec.tribe)?.get(spec.jobType)?.goodType
    : undefined;
  const fixedHeroArmorGood =
    fixedHeroArmor === undefined ? undefined : contentIndex(content).armor.get(fixedHeroArmor)?.goodType;
  if (heroJob && (fixedHeroWeapon !== undefined || fixedHeroArmorGood !== undefined)) {
    world.add(
      e,
      Equipment,
      equipmentFromCommand({
        ...(fixedHeroWeapon !== undefined ? { weapon: { goodType: fixedHeroWeapon } } : {}),
        ...(fixedHeroArmorGood !== undefined ? { armor: { goodType: fixedHeroArmorGood } } : {}),
      }),
    );
  } else if (mayChangeEquipment(world, content, e)) {
    // A woman and a child wear nothing, so a payload's equipment for them is dropped.
    const equipment = withSoldierClassWeapon(content, spec);
    if (equipment !== undefined) world.add(e, Equipment, equipmentFromCommand(equipment));
  }
  if (spec.moveSpeed !== undefined && spec.moveSpeed > 0) {
    world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(spec.moveSpeed)) });
  }
  stampOwner(world, e, spec.owner);
  stampMissionId(world, e, spec.missionId);
  stampMissionBehaviour(world, e, spec.behaviourFlags);
  if (spec.nameStringId !== undefined) nameHuman(world, e, spec.nameStringId);
  // The default stance is owned-only, so an unowned or golden settler carries no Stance at all.
  if (world.has(e, Owner)) stampDefaultStance(world, content, e, spec.jobType);
  return e;
}

/**
 * The `spawnSettler` command handler: create the settler and announce `settlerBorn` for render and audio.
 * An unknown job id yields no entity and no event, and is still logged so replay stays faithful.
 */
export function spawnSettler(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnSettler' }>,
): Entity | null {
  const e = createSettler(world, ctx.content, ctx.rng, command);
  if (e === null) return null;
  // A commanded spawn takes its (x,y) on trust and authored maps routinely name a cell inside a house body,
  // so the eviction must run before anything reads the position, including the work flag planted below.
  evictSettlerFromBlockedSpawn(world, ctx, e);
  // Before the flag: a settler its map posts to a workplace is not a flag gatherer, and planting one first
  // would only destroy it again.
  attachAuthoredBuildings(world, ctx, e, command);
  // An unposted gatherer or fisher is bound to a work flag planted at its feet the moment it is born.
  // Building-employed collectors instead bank their harvest into the building they are posted to.
  syncWorkFlagToJob(world, ctx, e, command.jobType);
  stampGatherGood(world, ctx, e, command);
  // After the flag: the attach order sets a carried load down and gives the workplace up, so a crewman
  // spawns exactly as a settler ordered aboard from a post would.
  attachAuthoredVehicle(world, ctx, e, command);
  ctx.events.emit({ kind: 'settlerBorn', entity: e });
  return e;
}

/**
 * Narrow a freshly spawned gatherer's work flag to its authored `gatherGood` (a decoded map's
 * `setproducedgood`), so an imported wood collector does not start on the gather-everything default. Bad
 * input leaves that default: no pick, a trade with no flag, or a good the trade cannot harvest.
 *
 * Approximation: only a flag-harvestable pick on an unposted settler lands. A settler its map also posts
 * to a workplace has no flag left to narrow by the time this runs, and a workshop product, a farm-bound
 * farmer's crop and a `hunter` → `prey` never had one.
 */
function stampGatherGood(
  world: World,
  ctx: SystemContext,
  e: Entity,
  command: Extract<Command, { kind: 'spawnSettler' }>,
): void {
  const goodType = command.gatherGood;
  if (goodType === undefined) return;
  const flag = world.tryGet(e, WorkFlag);
  if (flag === undefined || !jobCanHarvestGood(ctx, command.jobType, goodType)) return;
  world.mut(e, WorkFlag).goodType = goodType;
}

/** One command equipment slot → the component's {@link EquipmentSlot} (or null for an empty slot). The raw
 *  `degreeOfUsePct` (0..100) becomes the `Fixed` fraction `degreeOfUse`. */
function toEquipmentSlot(input: SettlerEquipmentSlot | null | undefined): EquipmentSlot | null {
  if (input === null || input === undefined) return null;
  const pct = Math.max(0, Math.min(100, Math.trunc(input.degreeOfUsePct ?? 0)));
  return { goodType: input.goodType, degreeOfUse: fx.div(fx.fromInt(pct), fx.fromInt(100)) };
}

/**
 * The spawn's equipment, with a soldier's class weapon good in the weapon slot when the spawn leaves that
 * slot unnamed; an explicit `null` slot stays empty. Original behavior: a created spear, sword or bow soldier
 * gets its class weapon, so a chest, mission or AI recruit stands up holding it. The
 * good is the `weapons.ini` `goodtype` of the (tribe, job) record combat already fights with.
 */
function withSoldierClassWeapon(content: ContentSet, spec: SettlerSpec): SettlerEquipment | undefined {
  // A command is the replay wire format, where an explicit `null` also means "no equipment".
  const equipment = spec.equipment ?? undefined;
  if (equipment?.weapon !== undefined || !isSoldierJob(content, spec.jobType)) return equipment;
  const goodType = contentIndex(content).weaponsByTribeAndJob.get(spec.tribe)?.get(spec.jobType)?.goodType;
  return goodType === undefined ? equipment : { ...equipment, weapon: { goodType } };
}

/** Build the {@link Equipment} component value from a command payload - the `misc` list is normalised to
 *  the fixed {@link MISC_EQUIP_SLOTS} length (excess dropped, short padded with empty slots). */
function equipmentFromCommand(equipment: SettlerEquipment): {
  boots: EquipmentSlot | null;
  tool: EquipmentSlot | null;
  weapon: EquipmentSlot | null;
  armor: EquipmentSlot | null;
  misc: ReadonlyArray<EquipmentSlot | null>;
} {
  const misc: (EquipmentSlot | null)[] = [];
  for (let i = 0; i < MISC_EQUIP_SLOTS; i++) misc.push(toEquipmentSlot(equipment.misc?.[i]));
  return {
    boots: toEquipmentSlot(equipment.boots),
    tool: toEquipmentSlot(equipment.tool),
    weapon: toEquipmentSlot(equipment.weapon),
    armor: toEquipmentSlot(equipment.armor),
    misc,
  };
}
