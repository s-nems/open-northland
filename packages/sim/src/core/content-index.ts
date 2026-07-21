import {
  type AnimalType,
  type ArmorType,
  type AtomicAnimation,
  type BuildingType,
  type ContentSet,
  type GatheringPipeline,
  type GoodType,
  type HumanJobExperienceType,
  indexById,
  type JobType,
  type LandscapeGfx,
  type Recipe,
  type TribeType,
  type VehicleType,
  type WeaponType,
} from '@open-northland/data';
import type { GoodsLine } from '../components/economy/infrastructure.js';
import { atomicBindingTables, harvestCapableJobs, jobAtomicSets } from './content-index/atomics.js';
import { byKey, byOptionalKey, byPairKey } from './content-index/by-key.js';
import { militaryGoodTypes } from './content-index/combat.js';
import { constructionBills } from './content-index/construction.js';
import {
  canonicalWorkerJobLists,
  inputlessProducerTypes,
  mergedRecipes,
  recipeProductTables,
  stockSlotCapacityTables,
  storedGoodSets,
  workerJobSets,
} from './content-index/production.js';
import { maxWorkCellOffset } from './content-index/terrain.js';

export { constructionBillForType } from './content-index/construction.js';

/** The job types whose atomics can harvest a standing resource — the sim's own definition of a
 *  gatherer trade, read through the memoized index rather than rebuilt per call. */
export function harvestJobsOf(content: ContentSet): ReadonlySet<number> {
  return contentIndex(content).harvestJobs;
}

/**
 * O(1) lookup maps over a {@link ContentSet}'s arrays, keyed the way per-tick code queries them.
 * Replaces the `ctx.content.buildings.find((b) => b.typeId === …)` linear scans that ran
 * per-entity-per-tick in hot systems (the "content-index" item of the scaling doctrine in
 * packages/sim/AGENTS.md). Pure derived data over immutable content — never hashed, never mutated —
 * so it is determinism-neutral by construction. The per-domain table builders live beside this file in
 * `content-index/`.
 *
 * Every table reproduces the duplicate-key semantics of the exact scan it replaced — mostly first-wins
 * (`byKey`: a duplicate key keeps the first array entry, what a `.find` returned); the two deliberate
 * exceptions are documented on their fields (`atomicBindingsByTribe` is last-wins per binding,
 * `landscapeGfxByIndex` is last-wins like the `new Map(pairs)` it replaced). So a lookup through the index is
 * provably the same record the linear code picked, even on (unexpected) duplicate ids.
 *
 * The weapon tables key the same way `attackerWeapon` (systems/conflict/weapons.ts) scanned the
 * non-unique `content.weapons` rows: first-in-source-order per `(tribeType, typeId)` /
 * `(tribeType, jobType)` / tribe alone — that scan runs per awake combatant per tick during a
 * battle, so it is indexed with its first-match semantics preserved.
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
  /** Vehicle types by `typeId`. */
  readonly vehicles: ReadonlyMap<number, VehicleType>;
  /** Command-boundary building lookup with `indexById`'s last-wins duplicate semantics. Runtime
   *  validation used to rebuild this map for every command. */
  readonly commandBuildings: ReadonlyMap<number, BuildingType>;
  /** Command-boundary job lookup with `indexById`'s last-wins duplicate semantics. */
  readonly commandJobs: ReadonlyMap<number, JobType>;
  /** Armor types by `typeId` (the armor-class id — see readviews/combat.ts). */
  readonly armor: ReadonlyMap<number, ArmorType>;
  /** Good types that ARE a weapon or piece of armor — the `goodType` a {@link WeaponType}/{@link ArmorType}
   *  resolves into (the forged military items). Used to charge a smith's piety per weapon/armor cycle
   *  (ProductionSystem). The natural-weapon sentinel (`goodType` absent) contributes nothing. */
  readonly militaryGoods: ReadonlySet<number>;
  /** Experience tracks by `typeId`. */
  readonly jobExperience: ReadonlyMap<number, HumanJobExperienceType>;
  /** Animal records by their `tribeType` (an animal's identity is its tribe). */
  readonly animalsByTribe: ReadonlyMap<number, AnimalType>;
  /** Atomic animations by `name` (the `setatomic` join key). */
  readonly atomicAnimationsByName: ReadonlyMap<string, AtomicAnimation>;
  /** Per building type: the set of job types its `workers` slots name (empty for a type with no
   *  worker slots). Precomputed so the per-tick staffing gates don't allocate. */
  readonly workerJobsByBuilding: ReadonlyMap<number, ReadonlySet<number>>;
  /** Per building type: the same job types as {@link workerJobsByBuilding}, ascending — the canonical
   *  slot order the automatic job scan offers them in. */
  readonly canonicalWorkerJobsByBuilding: ReadonlyMap<number, readonly number[]>;
  /** Per building type: the set of good types its `stock` slots store — what an employed gatherer may
   *  forage for. Absent for a type declaring no stock slots. */
  readonly storedGoodsByBuilding: ReadonlyMap<number, ReadonlySet<number>>;
  /**
   * Per building type: `goodType → its stock slot capacity` (first-wins per good, matching `.find`
   * over the slot list). The per-good ceiling `stockCapacity` reads — memoized because a warehouse
   * declares a slot per catalog good (~50) and the planner's sink scans probe the ceiling thousands of
   * times per tick; a linear `.find` there was a measured hot spot. Absent for a slot-less type.
   */
  readonly stockSlotCapacityByBuilding: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /**
   * Per producing building type: `product goodType → its recipe` (the recipe whose first output is
   * that good; first-wins on a duplicate product). The ProductionSystem's cycle-start/deposit lookup.
   */
  readonly recipeByProductByBuilding: ReadonlyMap<number, ReadonlyMap<number, Recipe>>;
  /**
   * Per producing building type: the UNION view over its per-product recipes — inputs summed per
   * goodType, outputs one line per product, both ascending (canonical). What the supply AI plans
   * against (fetch any input some product needs, haul any product out); the ProductionSystem itself
   * runs the per-product recipes. Absent for a non-producing type.
   */
  readonly mergedRecipeByBuilding: ReadonlyMap<number, Recipe>;
  /**
   * `goodType → building typeIds that produce it from an INPUT-LESS recipe` — the shared utilities a
   * consumer self-serves against (the well for water, the hive for honey). The data-driven signal
   * behind the self-service draw ({@link producesGoodWithoutInputs}); absent for a good no building
   * mints from nothing.
   */
  readonly inputlessProducersByGood: ReadonlyMap<number, ReadonlySet<number>>;
  /** Weapons by `(tribeType, typeId)` — the worn-weapon override key; first-wins per pair, the
   *  first-in-source-order record the old `.find` scan returned. */
  readonly weaponsByTribeAndTypeId: ReadonlyMap<number, ReadonlyMap<number, WeaponType>>;
  /** Weapons by `(tribeType, jobType)` — how a jobbed combatant binds its class weapon; first-wins
   *  per pair (source order). */
  readonly weaponsByTribeAndJob: ReadonlyMap<number, ReadonlyMap<number, WeaponType>>;
  /** The first weapon row of each tribe (source order) — a jobless animal's weapon (its combat identity is
   *  its tribe alone). */
  readonly firstWeaponByTribe: ReadonlyMap<number, WeaponType>;
  /**
   * Per tribe: the `setatomic` bindings resolved `jobType → atomicId → animation name`, built last-wins over
   * the file-order bindings — the override semantics the linear walk it replaces implemented (a later
   * `setatomic` line for the same (job, atomic) shadows an earlier one), so a lookup here returns the
   * identical name.
   */
  readonly atomicBindingsByTribe: ReadonlyMap<number, ReadonlyMap<number, ReadonlyMap<number, string>>>;
  /** Per-good gathering pipelines by `goodType`. */
  readonly gatheringPipelinesByGood: ReadonlyMap<number, GatheringPipeline>;
  /** Landscape gfx records by their `index` (the gathering pipeline's join key). Last-wins on a duplicate
   *  index — the semantics of the `new Map(records.map(...))` it replaced. */
  readonly landscapeGfxByIndex: ReadonlyMap<number, LandscapeGfx>;
  /**
   * Per job type: the set of atomic ids the job may run — `allowedAtomics` ∪ `baseAtomics` minus
   * `forbiddenAtomics` (an explicit denial overrides an allow), the `jobtypes` permission gate.
   * Precomputed so the per-settler planner reads a shared set instead of building one per call.
   */
  readonly atomicsByJob: ReadonlyMap<number, ReadonlySet<number>>;
  /** The flag-gathering trades: jobs whose grants (`allowedAtomics` minus `forbiddenAtomics`) include a
   *  non-farmed good's harvest atomic. Excludes the tribe-wide `baseAtomics` on purpose — a base atomic
   *  that coincides with a good's harvest atomic (real soldier `baseAtomics=[31]` == herb's harvest 31)
   *  must not make that job a gatherer. See {@link import('../systems/economy/flags.js').jobCanHarvest}. */
  readonly harvestJobs: ReadonlySet<number>;
  /**
   * Per building type: the FROM-SCRATCH construction bill — what a newly-placed site of this type must
   * be delivered and hammer in. For a leveled type this is the merged sum of every chain tier's own
   * `construction` up to and including it (the chain is the extracted `upgradeTarget` join, walked down
   * from this tier to its base), so building tier N directly costs stages 1..N, exactly like building
   * tier 1 and upgrading N−1 times. Source basis: the per-tier `construction` costs and the chain are
   * extracted; the merge is our design invariant. The original never places a higher tier directly
   * (chains start at their base and level up), so direct placement is an OpenNorthland capability priced
   * to match the original's base-then-upgrade total rather than let it undercut that path. An unchained
   * type's bill is its own `construction`. Lines are merged per goodType and sorted ascending (canonical
   * order for the picks that scan them). The upgrade path itself never reads this — an upgrading site
   * pays only the target tier's own cost (`constructionBillOf`).
   */
  readonly constructionBillByBuilding: ReadonlyMap<number, readonly GoodsLine[]>;
  /**
   * The largest Manhattan node-offset any resource's work cell can sit from its anchor, over every
   * `landscapeGfx` work-area cell — floored at 3, covering both `resourceWorkCell` fallbacks with headroom:
   * `nearestFreeNeighbour` walks the orthogonal neighbour set (Manhattan 1, `nav/terrain/graph.ts`
   * NEIGHBOUR_OFFSETS), and the lattice's widest single step (a diagonal, `(±1,±2)`) is Manhattan 3 — so even
   * a future fallback widened to the full step set stays under the floor. The slack a radius-bounded candidate
   * query must widen its anchor box by so it provably contains every node whose work cell could pass the
   * radius test (see `resourcesNearNode`); over-covering only grows the queried box, never a winner.
   */
  readonly maxResourceWorkOffset: number;
}

/** One index per ContentSet, built lazily on first use and shared by every consumer (sim systems,
 *  read views, tests) — a WeakMap so a dropped content set frees its index with it. */
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
  return {
    buildings: byKey(content.buildings, (b) => b.typeId),
    goods: byKey(content.goods, (g) => g.typeId),
    jobs: byKey(content.jobs, (j) => j.typeId),
    tribes: byKey(content.tribes, (t) => t.typeId),
    vehicles: byKey(content.vehicles, (v) => v.typeId),
    commandBuildings: indexById(content.buildings),
    commandJobs: indexById(content.jobs),
    armor: byKey(content.armor, (a) => a.typeId),
    militaryGoods: militaryGoodTypes(content),
    jobExperience: byKey(content.jobExperience, (t) => t.typeId),
    animalsByTribe: byKey(content.animals, (a) => a.tribeType),
    atomicAnimationsByName: byKey(content.atomicAnimations, (a) => a.name),
    workerJobsByBuilding: workerJobs,
    canonicalWorkerJobsByBuilding: canonicalWorkerJobLists(workerJobs),
    storedGoodsByBuilding: storedGoodSets(content),
    stockSlotCapacityByBuilding: stockSlotCapacityTables(content),
    recipeByProductByBuilding: recipeProductTables(content),
    mergedRecipeByBuilding: mergedRecipes(content),
    inputlessProducersByGood: inputlessProducerTypes(content),
    atomicBindingsByTribe: atomicBindingTables(content),
    gatheringPipelinesByGood: byKey(content.gatheringPipeline, (p) => p.goodType),
    landscapeGfxByIndex: new Map(content.landscapeGfx.map((g) => [g.index, g])), // last-wins, as before
    atomicsByJob: jobAtomicSets(content),
    constructionBillByBuilding: constructionBills(content),
    harvestJobs: harvestCapableJobs(content),
    maxResourceWorkOffset: maxWorkCellOffset(content),
    // A weapon row's tribeType/jobType are optional in the schema; a row missing the key could never
    // match the numeric comparison the old scans made, so it is simply absent from that table.
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
    firstWeaponByTribe: byOptionalKey(content.weapons, (w) => w.tribeType),
  };
}
