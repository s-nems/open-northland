import {
  type AnimalType,
  type ArmorType,
  type AtomicAnimation,
  type BuildingType,
  type ContentSet,
  fullStateBlockAreaCells,
  type GatheringPipeline,
  type GoodType,
  type HumanJobExperienceType,
  type JobType,
  type LandscapeGfx,
  type TribeType,
  type VehicleType,
  type WeaponType,
} from '@open-northland/data';

/**
 * O(1) lookup maps over a {@link ContentSet}'s arrays, keyed the way per-tick code queries them.
 * Replaces the `ctx.content.buildings.find((b) => b.typeId === …)` linear scans that ran
 * per-entity-per-tick in hot systems (the "content-index" item of the scaling doctrine in
 * packages/sim/AGENTS.md). Pure derived data over immutable content — never hashed, never mutated —
 * so it is determinism-neutral by construction.
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
  /** Experience tracks by `typeId`. */
  readonly jobExperience: ReadonlyMap<number, HumanJobExperienceType>;
  /** Animal records by their `tribeType` (an animal's identity is its tribe). */
  readonly animalsByTribe: ReadonlyMap<number, AnimalType>;
  /** Atomic animations by `name` (the `setatomic` join key). */
  readonly atomicAnimationsByName: ReadonlyMap<string, AtomicAnimation>;
  /** Per building type: the set of job types its `workers` slots name (empty for a type with no
   *  worker slots). Precomputed so the per-tick staffing gates don't allocate. */
  readonly workerJobsByBuilding: ReadonlyMap<number, ReadonlySet<number>>;
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
  return {
    buildings: byKey(content.buildings, (b) => b.typeId),
    goods: byKey(content.goods, (g) => g.typeId),
    jobs: byKey(content.jobs, (j) => j.typeId),
    tribes: byKey(content.tribes, (t) => t.typeId),
    vehicles: byKey(content.vehicles, (v) => v.typeId),
    commandBuildings: byKeyLast(content.buildings, (b) => b.typeId),
    commandJobs: byKeyLast(content.jobs, (j) => j.typeId),
    armor: byKey(content.armor, (a) => a.typeId),
    jobExperience: byKey(content.jobExperience, (t) => t.typeId),
    animalsByTribe: byKey(content.animals, (a) => a.tribeType),
    atomicAnimationsByName: byKey(content.atomicAnimations, (a) => a.name),
    workerJobsByBuilding: workerJobSets(content),
    atomicBindingsByTribe: atomicBindingTables(content),
    gatheringPipelinesByGood: byKey(content.gatheringPipeline, (p) => p.goodType),
    landscapeGfxByIndex: new Map(content.landscapeGfx.map((g) => [g.index, g])), // last-wins, as before
    atomicsByJob: jobAtomicSets(content),
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

/** Map `items` by a two-level key, first-wins per pair — the first source-order record a compound
 *  `.find((x) => a(x) === … && b(x) === …)` scan returned. An item whose key half is undefined is
 *  skipped (it could never match a numeric comparison). */
function byPairKey<T>(
  items: readonly T[],
  outer: (item: T) => number | undefined,
  inner: (item: T) => number | undefined,
): ReadonlyMap<number, ReadonlyMap<number, T>> {
  const map = new Map<number, Map<number, T>>();
  for (const item of items) {
    const o = outer(item);
    const i = inner(item);
    if (o === undefined || i === undefined) continue;
    let innerMap = map.get(o);
    if (innerMap === undefined) {
      innerMap = new Map<number, T>();
      map.set(o, innerMap);
    }
    if (!innerMap.has(i)) innerMap.set(i, item);
  }
  return map;
}

/** {@link byKey} over an optional key — an item without the key is skipped (it could never match). */
function byOptionalKey<T>(items: readonly T[], key: (item: T) => number | undefined): ReadonlyMap<number, T> {
  const map = new Map<number, T>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined || map.has(k)) continue;
    map.set(k, item);
  }
  return map;
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

/** The per-building-type worker-job sets — first-wins per typeId unconditionally (a first record with zero
 *  workers claims the key with an empty set, exactly as the `.find` it replaced resolved the first record and
 *  read its empty `workers`), so a later duplicate can never shadow it. */
function workerJobSets(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const map = new Map<number, ReadonlySet<number>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId)) continue;
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

/** Map `items` by `key`, last-wins — the duplicate semantics of `@open-northland/data`'s `indexById`.
 *  Kept separate from the hot read-view tables above, whose replaced `.find` scans are first-wins. */
function byKeyLast<K, T>(items: readonly T[], key: (item: T) => K): ReadonlyMap<K, T> {
  const map = new Map<K, T>();
  for (const item of items) map.set(key(item), item);
  return map;
}

/**
 * The largest |dx|+|dy| any `landscapeGfx` work-area cell sits from its record's anchor (the full-state
 * reading `resourceWorkCell` places collectors by), floored at 3 — see
 * {@link ContentIndex.maxResourceWorkOffset} for the fallback-coverage argument.
 */
function maxWorkCellOffset(content: ContentSet): number {
  let max = 3;
  for (const record of content.landscapeGfx) {
    for (const cell of fullStateBlockAreaCells(record.workAreas)) {
      const offset = Math.abs(cell.dx) + Math.abs(cell.dy);
      if (offset > max) max = offset;
    }
  }
  return max;
}
