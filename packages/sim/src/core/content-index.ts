import {
  type AnimalType,
  type ArmorType,
  type AtomicAnimation,
  type BuildingType,
  type ContentSet,
  type GatheringPipeline,
  type GoodType,
  type HumanJobExperienceType,
  type HuntPrey,
  type JobType,
  type LandscapeGfx,
  lastByTypeId,
  type Recipe,
  resolveJobAtomics,
  type TribeType,
  type VehicleType,
  type WeaponType,
} from '@open-northland/data';
import type { GoodsLine } from '../components/economy/infrastructure.js';
import { atomicBindingTables, harvestCapableJobs } from './content-index/atomics.js';
import { byKey, byOptionalKey, byPairKey } from './content-index/by-key.js';
import { militaryGoodTypes } from './content-index/combat.js';
import { constructionBills } from './content-index/construction.js';
import { jobRoleSets } from './content-index/jobs.js';
import { livestockTables } from './content-index/livestock.js';
import {
  inputlessProducerTypes,
  mergedRecipes,
  recipeProductTables,
  stockSlotCapacityTables,
  storedGoodSets,
  workerJobSets,
} from './content-index/production.js';
import { type EnablingJobTables, enablingJobTables } from './content-index/progression.js';
import { maxWorkCellOffset } from './content-index/terrain.js';

export { constructionBillForType } from './content-index/construction.js';

/** The job types whose atomics can harvest a standing resource - the sim's definition of a gatherer
 *  trade. */
export function harvestJobsOf(content: ContentSet): ReadonlySet<number> {
  return contentIndex(content).harvestJobs;
}

/**
 * O(1) lookup maps over a {@link ContentSet}'s arrays, keyed the way per-tick code queries them. Pure
 * derived data over immutable content, never hashed and never mutated, so it is determinism-neutral.
 *
 * A duplicate key keeps the first array entry unless a field says otherwise; the two exceptions are
 * `atomicBindingsByTribe` and `landscapeGfxByIndex`, which are last-wins.
 */
export interface ContentIndex {
  /** Building types by `typeId`. */
  readonly buildings: ReadonlyMap<number, BuildingType>;
  /** Good types by `typeId`. */
  readonly goods: ReadonlyMap<number, GoodType>;
  /** Job types by `typeId`. */
  readonly jobs: ReadonlyMap<number, JobType>;
  /** Tribe types by `typeId`. */
  readonly tribes: ReadonlyMap<number, TribeType>;
  /** The `jobEnables*` tech graph grouped for the unlock gate. See {@link EnablingJobTables}. */
  readonly enablingJobsByTribe: EnablingJobTables;
  /** Vehicle types by `typeId`. */
  readonly vehicles: ReadonlyMap<number, VehicleType>;
  /** Command-boundary building lookup - last-wins on a duplicate typeId, unlike {@link buildings}. */
  readonly commandBuildings: ReadonlyMap<number, BuildingType>;
  /** Command-boundary job lookup - last-wins on a duplicate typeId, unlike {@link jobs}. */
  readonly commandJobs: ReadonlyMap<number, JobType>;
  /** Armor types by `typeId` (the armor-class id - see readviews/combat.ts). */
  readonly armor: ReadonlyMap<number, ArmorType>;
  /** Armor types by the good that IS the armor (`goodType`), how a worn `Equipment.armor` slot joins
   *  its `[armortype]` record; first-wins, a record with no `goodType` is absent. */
  readonly armorByGoodType: ReadonlyMap<number, ArmorType>;
  /** Good types that are themselves a weapon or piece of armor - the `goodType` a {@link WeaponType} or
   *  {@link ArmorType} resolves into. The natural-weapon sentinel (no `goodType`) contributes nothing. */
  readonly militaryGoods: ReadonlySet<number>;
  /** Experience tracks by `typeId`. */
  readonly jobExperience: ReadonlyMap<number, HumanJobExperienceType>;
  /** Animal records by their `tribeType` (an animal's identity is its tribe). */
  readonly animalsByTribe: ReadonlyMap<number, AnimalType>;
  /** Hunt-prey rows by the prey's `tribeType` - membership IS huntability ({@link HuntPrey}). */
  readonly huntPreyByTribe: ReadonlyMap<number, HuntPrey>;
  /** Livestock species (`catchable` animal tribeType) → the good stocking one FED animal of that
   *  species (the animal farm's feed-recipe product). See `content-index/livestock.ts` for the join. */
  readonly livestockGoodByTribe: ReadonlyMap<number, number>;
  /** Reverse of {@link livestockGoodByTribe}: livestock goodType → the species' animal tribeType. */
  readonly livestockTribeByGood: ReadonlyMap<number, number>;
  /** Building types with a feed recipe - the workplaces claimed livestock is herded to. */
  readonly livestockWorkplaceTypes: ReadonlySet<number>;
  /** The `meat` good (slug-resolved) - the feed-cycle byproduct target; null without one. */
  readonly livestockMeatGood: number | null;
  /** Atomic animations by `name` (the `setatomic` join key). */
  readonly atomicAnimationsByName: ReadonlyMap<string, AtomicAnimation>;
  /** Per building type: the set of job types its `workers` slots name (empty for a type with no
   *  worker slots). */
  readonly workerJobsByBuilding: ReadonlyMap<number, ReadonlySet<number>>;
  /** Per building type: the set of good types its `stock` slots store - what an employed gatherer may
   *  forage for. Absent for a type declaring no stock slots. */
  readonly storedGoodsByBuilding: ReadonlyMap<number, ReadonlySet<number>>;
  /**
   * Per building type: `goodType → its stock slot capacity`, the per-good ceiling `stockCapacity`
   * reads. First-wins per good; absent for a slot-less type.
   */
  readonly stockSlotCapacityByBuilding: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /**
   * Per producing building type: `product goodType → its recipe` (the recipe whose first output is
   * that good; first-wins on a duplicate product). The ProductionSystem's cycle-start/deposit lookup.
   */
  readonly recipeByProductByBuilding: ReadonlyMap<number, ReadonlyMap<number, Recipe>>;
  /**
   * Per producing building type: the union over its per-product recipes, with inputs summed per
   * goodType and one output line per product, both in ascending canonical order. Absent for a
   * non-producing type.
   */
  readonly mergedRecipeByBuilding: ReadonlyMap<number, Recipe>;
  /**
   * `goodType → building typeIds that produce it from an input-less recipe` - the shared utilities a
   * consumer self-serves against (the well for water, the hive for honey). Absent for a good no
   * building mints from nothing.
   */
  readonly inputlessProducersByGood: ReadonlyMap<number, ReadonlySet<number>>;
  /** Weapons by `(tribeType, typeId)` - the worn-weapon override key; first-wins per pair (source
   *  order). */
  readonly weaponsByTribeAndTypeId: ReadonlyMap<number, ReadonlyMap<number, WeaponType>>;
  /** Weapons by `(tribeType, jobType)` - how a jobbed combatant binds its class weapon; first-wins
   *  per pair (source order). */
  readonly weaponsByTribeAndJob: ReadonlyMap<number, ReadonlyMap<number, WeaponType>>;
  /** Weapons by `(tribeType, goodType)` - which weapon a craftable good IS (`weapons.ini` `goodtype`),
   *  the equip-drive's good→class join; first-wins per pair (source order). */
  readonly weaponByTribeAndGoodType: ReadonlyMap<number, ReadonlyMap<number, WeaponType>>;
  /** The first weapon row of each tribe (source order) - a jobless animal's weapon (its combat identity is
   *  its tribe alone). */
  readonly firstWeaponByTribe: ReadonlyMap<number, WeaponType>;
  /** Each tribe's `house_bow` row - the wall bow a sheltering civilian shoots, resolved by weapon id
   *  because the shooter keeps its own trade. */
  readonly houseBowByTribe: ReadonlyMap<number, WeaponType>;
  /**
   * Per tribe: the `setatomic` bindings resolved `jobType → atomicId → animation name`, last-wins over
   * file order so a later `setatomic` line for the same (job, atomic) shadows an earlier one.
   */
  readonly atomicBindingsByTribe: ReadonlyMap<number, ReadonlyMap<number, ReadonlyMap<number, string>>>;
  /** Per-good gathering pipelines by `goodType`. */
  readonly gatheringPipelinesByGood: ReadonlyMap<number, GatheringPipeline>;
  /** Landscape gfx records by their `index` (the gathering pipeline's join key); last-wins on a
   *  duplicate index. */
  readonly landscapeGfxByIndex: ReadonlyMap<number, LandscapeGfx>;
  /** Per job type: the atomic ids the job may run (`resolveJobAtomics`), the `jobtypes` permission
   *  gate. */
  readonly atomicsByJob: ReadonlyMap<number, ReadonlySet<number>>;
  /** The flag-gathering trades: jobs whose {@link atomicsByJob} include a non-farmed good's harvest
   *  atomic. */
  readonly harvestJobs: ReadonlySet<number>;
  /** The trades of each {@link jobRoleSets} role, by job typeId. */
  readonly soldierJobs: ReadonlySet<number>;
  readonly heroJobs: ReadonlySet<number>;
  readonly scoutJobs: ReadonlySet<number>;
  readonly hunterJobs: ReadonlySet<number>;
  /**
   * Per building type: the from-scratch construction bill a newly-placed site must be delivered, merged
   * per goodType and sorted ascending. For a leveled type it sums every tier's own `construction` up to
   * and including it, so placing tier N costs what building tier 1 and upgrading N-1 times costs; an
   * unchained type's bill is its own `construction`. Source basis: the per-tier costs and the
   * `upgradeTarget` chain are extracted, the merge is authored, because the original only ever places a
   * chain's base tier. An upgrading site instead pays the target tier's own cost (`constructionBillOf`).
   */
  readonly constructionBillByBuilding: ReadonlyMap<number, readonly GoodsLine[]>;
  /**
   * The largest Manhattan node-offset any resource's work cell can sit from its anchor, over every
   * `landscapeGfx` work-area cell, floored at 3 to cover the lattice's widest single step (a diagonal,
   * `(±1,±2)`). A radius-bounded candidate query widened by this slack provably contains every node
   * whose work cell could pass the radius test; over-covering only grows the queried box.
   */
  readonly maxResourceWorkOffset: number;
}

/** One index per ContentSet, built lazily on first use and shared by every consumer; a WeakMap so a
 *  dropped content set frees its index with it. */
const indexCache = new WeakMap<ContentSet, ContentIndex>();

export function contentIndex(content: ContentSet): ContentIndex {
  let index = indexCache.get(content);
  if (index === undefined) {
    index = buildIndex(content);
    indexCache.set(content, index);
  }
  return index;
}

function buildIndex(content: ContentSet): ContentIndex {
  const workerJobs = workerJobSets(content);
  const jobs = byKey(content.jobs, (j) => j.typeId);
  const roles = jobRoleSets(jobs);
  const tribes = byKey(content.tribes, (t) => t.typeId);
  const livestock = livestockTables(content);
  return {
    buildings: byKey(content.buildings, (b) => b.typeId),
    goods: byKey(content.goods, (g) => g.typeId),
    jobs,
    tribes,
    enablingJobsByTribe: enablingJobTables(tribes),
    vehicles: byKey(content.vehicles, (v) => v.typeId),
    commandBuildings: lastByTypeId(content.buildings),
    commandJobs: lastByTypeId(content.jobs),
    armor: byKey(content.armor, (a) => a.typeId),
    armorByGoodType: byOptionalKey(content.armor, (a) => a.goodType),
    militaryGoods: militaryGoodTypes(content),
    jobExperience: byKey(content.jobExperience, (t) => t.typeId),
    animalsByTribe: byKey(content.animals, (a) => a.tribeType),
    huntPreyByTribe: byKey(content.huntPrey, (p) => p.tribeType),
    livestockGoodByTribe: livestock.goodByTribe,
    livestockTribeByGood: livestock.tribeByGood,
    livestockWorkplaceTypes: livestock.workplaceTypes,
    livestockMeatGood: livestock.meatGood,
    atomicAnimationsByName: byKey(content.atomicAnimations, (a) => a.name),
    workerJobsByBuilding: workerJobs,
    storedGoodsByBuilding: storedGoodSets(content),
    stockSlotCapacityByBuilding: stockSlotCapacityTables(content),
    recipeByProductByBuilding: recipeProductTables(content, livestock.workplaceTypes),
    mergedRecipeByBuilding: mergedRecipes(content),
    inputlessProducersByGood: inputlessProducerTypes(content),
    atomicBindingsByTribe: atomicBindingTables(content),
    gatheringPipelinesByGood: byKey(content.gatheringPipeline, (p) => p.goodType),
    landscapeGfxByIndex: new Map(content.landscapeGfx.map((g) => [g.index, g])), // last-wins
    atomicsByJob: resolveJobAtomics(content.jobs),
    constructionBillByBuilding: constructionBills(content),
    harvestJobs: harvestCapableJobs(content),
    soldierJobs: roles.soldier,
    heroJobs: roles.hero,
    scoutJobs: roles.scout,
    hunterJobs: roles.hunter,
    maxResourceWorkOffset: maxWorkCellOffset(content),
    // A weapon row's tribeType/jobType are optional in the schema; a row missing the key is absent
    // from that table.
    weaponsByTribeAndTypeId: byPairKey(
      content.weapons,
      (w) => w.tribeType,
      (w) => w.typeId,
    ),
    weaponsByTribeAndJob: byPairKey(
      content.weapons,
      (w) => w.tribeType,
      (w) => w.jobType,
    ),
    weaponByTribeAndGoodType: byPairKey(
      content.weapons,
      (w) => w.tribeType,
      (w) => w.goodType,
    ),
    firstWeaponByTribe: byOptionalKey(content.weapons, (w) => w.tribeType),
    houseBowByTribe: byOptionalKey(
      content.weapons.filter((w) => w.id === HOUSE_BOW_WEAPON_ID),
      (w) => w.tribeType,
    ),
  };
}

/** The stable `weapons.ini` id of the wall bow ({@link ContentIndex.houseBowByTribe}). */
const HOUSE_BOW_WEAPON_ID = 'house_bow';
