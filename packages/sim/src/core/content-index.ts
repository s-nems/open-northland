import type {
  AnimalType,
  ArmorType,
  AtomicAnimation,
  BuildingType,
  ContentSet,
  GatheringPipeline,
  GoodType,
  HumanJobExperienceType,
  JobType,
  LandscapeGfx,
  TribeType,
  VehicleType,
} from '@vinland/data';

/**
 * O(1) lookup maps over a {@link ContentSet}'s arrays, keyed the way per-tick code queries them.
 * Replaces the `ctx.content.buildings.find((b) => b.typeId === …)` linear scans that ran
 * per-entity-per-tick in hot systems (the "content-index" item of the scaling doctrine in
 * packages/sim/AGENTS.md). Pure derived data over immutable content — never hashed, never mutated —
 * so it is determinism-neutral by construction.
 *
 * Every map is built **first-wins** (`registerFirst`): a duplicate key keeps the FIRST array entry,
 * which is exactly what the `.find` scans it replaces returned, so a lookup through the index is
 * provably the same record a linear scan would pick even on (unexpected) duplicate ids.
 *
 * NOT indexed on purpose: `content.weapons` — its combat lookups key on non-unique
 * `(tribeType, jobType)` / `(tribeType, typeId)` pairs with documented first-in-source-order
 * semantics (see `attackerWeapon` in systems/conflict/combat.ts); those scans are per-swing-start,
 * not per-entity-per-tick, and the array-not-Map stance there is deliberate.
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
  /** Armor types by `typeId` (the armor-class id — see readviews/combat.ts). */
  readonly armor: ReadonlyMap<number, ArmorType>;
  /** Experience tracks by `typeId`. */
  readonly jobExperience: ReadonlyMap<number, HumanJobExperienceType>;
  /** Animal records by their `tribeType` (an animal's identity IS its tribe). */
  readonly animalsByTribe: ReadonlyMap<number, AnimalType>;
  /** Atomic animations by `name` (the `setatomic` join key). */
  readonly atomicAnimationsByName: ReadonlyMap<string, AtomicAnimation>;
  /** Per building type: the set of job types its `workers` slots name (empty set omitted — a type
   *  with no worker slots has no entry). Precomputed so the per-tick staffing gates don't allocate. */
  readonly workerJobsByBuilding: ReadonlyMap<number, ReadonlySet<number>>;
  /**
   * Per tribe: the `setatomic` bindings resolved `jobType → atomicId → animation name`, built
   * **last-wins over the file-order bindings** — exactly the override semantics the linear walk it
   * replaces implemented (a later `setatomic` line for the same (job, atomic) shadows an earlier
   * one), so a lookup here returns the identical name.
   */
  readonly atomicBindingsByTribe: ReadonlyMap<number, ReadonlyMap<number, ReadonlyMap<number, string>>>;
  /** Per-good gathering pipelines by `goodType`. */
  readonly gatheringPipelinesByGood: ReadonlyMap<number, GatheringPipeline>;
  /** Landscape gfx records by their `index` (the gathering pipeline's join key). */
  readonly landscapeGfxByIndex: ReadonlyMap<number, LandscapeGfx>;
  /**
   * Per job type: the set of atomic ids the job may run — `allowedAtomics` ∪ `baseAtomics` minus
   * `forbiddenAtomics` (an explicit denial overrides an allow), the `jobtypes` permission gate.
   * Precomputed so the per-settler planner reads a shared set instead of building one per call.
   */
  readonly atomicsByJob: ReadonlyMap<number, ReadonlySet<number>>;
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
  return {
    buildings: byKey(content.buildings, (b) => b.typeId),
    goods: byKey(content.goods, (g) => g.typeId),
    jobs: byKey(content.jobs, (j) => j.typeId),
    tribes: byKey(content.tribes, (t) => t.typeId),
    vehicles: byKey(content.vehicles, (v) => v.typeId),
    armor: byKey(content.armor, (a) => a.typeId),
    jobExperience: byKey(content.jobExperience, (t) => t.typeId),
    animalsByTribe: byKey(content.animals, (a) => a.tribeType),
    atomicAnimationsByName: byKey(content.atomicAnimations, (a) => a.name),
    workerJobsByBuilding: workerJobSets(content),
    atomicBindingsByTribe: atomicBindingTables(content),
    gatheringPipelinesByGood: byKey(content.gatheringPipeline, (p) => p.goodType),
    landscapeGfxByIndex: byKey(content.landscapeGfx, (g) => g.index),
    atomicsByJob: jobAtomicSets(content),
  };
}

/** The per-job allowed-atomic sets (first-wins per typeId, like every other table). */
function jobAtomicSets(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const map = new Map<number, ReadonlySet<number>>();
  for (const job of content.jobs) {
    if (map.has(job.typeId)) continue;
    const set = new Set<number>(job.allowedAtomics);
    for (const a of job.baseAtomics) set.add(a);
    for (const a of job.forbiddenAtomics) set.delete(a);
    map.set(job.typeId, set);
  }
  return map;
}

/** The per-tribe `setatomic` binding tables (first-wins per tribe typeId; last-wins per binding —
 *  see {@link ContentIndex.atomicBindingsByTribe}). */
function atomicBindingTables(
  content: ContentSet,
): ReadonlyMap<number, ReadonlyMap<number, ReadonlyMap<number, string>>> {
  const byTribe = new Map<number, Map<number, Map<number, string>>>();
  for (const tribe of content.tribes) {
    if (byTribe.has(tribe.typeId)) continue;
    const byJob = new Map<number, Map<number, string>>();
    for (const b of tribe.atomicBindings) {
      let byAtomic = byJob.get(b.jobType);
      if (byAtomic === undefined) {
        byAtomic = new Map<number, string>();
        byJob.set(b.jobType, byAtomic);
      }
      byAtomic.set(b.atomicId, b.animation); // last-wins: a later binding overwrites
    }
    byTribe.set(tribe.typeId, byJob);
  }
  return byTribe;
}

/** The per-building-type worker-job sets (first-wins per typeId, like every other table). */
function workerJobSets(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const map = new Map<number, ReadonlySet<number>>();
  for (const b of content.buildings) {
    if (b.workers.length === 0 || map.has(b.typeId)) continue;
    map.set(b.typeId, new Set(b.workers.map((w) => w.jobType)));
  }
  return map;
}

/** Map `items` by `key`, first-wins — a duplicate key keeps the first entry, matching `.find`. */
function byKey<K, T>(items: readonly T[], key: (item: T) => K): ReadonlyMap<K, T> {
  const map = new Map<K, T>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, item);
  }
  return map;
}
