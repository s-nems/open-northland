import type { ContentSet, Recipe } from '@open-northland/data';
import { harvestCapableJobs } from './atomics.js';

/** The content `id` slug of the transport (carrier) job — mirrors `isCarrierJob`'s slug test, in
 *  content space (no World). A carrier/gatherer-only building has no operator trade. */
const CARRIER_JOB_ID = 'carrier';

/** The per-building-type `product → recipe` tables
 *  ({@link import('../content-index.js').ContentIndex.recipeByProductByBuilding}) — first-wins per typeId
 *  like the other tables; a recipe's product key is its first output's goodType (per-product recipes carry
 *  exactly one output), first-wins on a duplicate product. Types without recipes are absent. */
export function recipeProductTables(content: ContentSet): ReadonlyMap<number, ReadonlyMap<number, Recipe>> {
  const map = new Map<number, ReadonlyMap<number, Recipe>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId) || b.recipes.length === 0) continue;
    const byProduct = new Map<number, Recipe>();
    for (const recipe of b.recipes) {
      const product = recipe.outputs[0]?.goodType;
      if (product !== undefined && !byProduct.has(product)) byProduct.set(product, recipe);
    }
    map.set(b.typeId, byProduct);
  }
  return map;
}

/** The per-building-type union recipes ({@link import('../content-index.js').ContentIndex.mergedRecipeByBuilding}):
 *  inputs summed per goodType and outputs merged per goodType across the type's per-product recipes, both
 *  ascending — the single-recipe view the supply AI plans against. First-wins per typeId; `ticks` is the max
 *  over the merged recipes (the union view never times a cycle, but the field is required). */
export function mergedRecipes(content: ContentSet): ReadonlyMap<number, Recipe> {
  const map = new Map<number, Recipe>();
  for (const b of content.buildings) {
    if (map.has(b.typeId) || b.recipes.length === 0) continue;
    const inputs = new Map<number, number>();
    const outputs = new Map<number, number>();
    let ticks = 1;
    for (const recipe of b.recipes) {
      for (const io of recipe.inputs) inputs.set(io.goodType, (inputs.get(io.goodType) ?? 0) + io.amount);
      for (const io of recipe.outputs) outputs.set(io.goodType, (outputs.get(io.goodType) ?? 0) + io.amount);
      if (recipe.ticks > ticks) ticks = recipe.ticks;
    }
    const lines = (m: Map<number, number>) =>
      [...m].sort(([a], [c]) => a - c).map(([goodType, amount]) => ({ goodType, amount }));
    map.set(b.typeId, { inputs: lines(inputs), outputs: lines(outputs), ticks });
  }
  return map;
}

/**
 * `goodType → the building typeIds a consumer self-serves it from` — the shared UNSTAFFED utilities that
 * mint a good from no inputs (the well drawing water, the hive drawing honey). A type qualifies only when
 * it both (a) has a recipe producing the good with no inputs, and (b) is unstaffed-by-design: every worker
 * slot is a carrier or gatherer, none an operator trade. Condition (b) excludes a STAFFED input-less
 * producer — the animal farm's breeders mint meat from nothing, but that is real husbandry, not a public
 * tap a stranger cranks. The signal is data ("an unstaffed input-less producer of the needed good"), never
 * a hardcoded well/hive id. First-wins per typeId, matching the other tables.
 */
export function inputlessProducerTypes(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const carrierJobs = new Set(content.jobs.filter((j) => j.id === CARRIER_JOB_ID).map((j) => j.typeId));
  const harvestJobs = harvestCapableJobs(content);
  const isOperatorSlot = (jobType: number): boolean => !carrierJobs.has(jobType) && !harvestJobs.has(jobType);
  const map = new Map<number, Set<number>>();
  const seen = new Set<number>();
  for (const b of content.buildings) {
    if (seen.has(b.typeId)) continue;
    seen.add(b.typeId);
    if (b.workers.some((w) => isOperatorSlot(w.jobType))) continue; // staffed — not a self-service tap
    for (const recipe of b.recipes) {
      if (recipe.inputs.length > 0) continue;
      const product = recipe.outputs[0]?.goodType;
      if (product === undefined) continue;
      let types = map.get(product);
      if (types === undefined) {
        types = new Set<number>();
        map.set(product, types);
      }
      types.add(b.typeId);
    }
  }
  return map;
}

/** The per-building-type worker-job sets — first-wins per typeId unconditionally (a first record with zero
 *  workers claims the key with an empty set, exactly as the `.find` it replaced resolved the first record and
 *  read its empty `workers`), so a later duplicate can never shadow it. */
export function workerJobSets(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const map = new Map<number, ReadonlySet<number>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId)) continue;
    map.set(b.typeId, new Set(b.workers.map((w) => w.jobType)));
  }
  return map;
}

/** The per-type worker job ids in ascending order, over the sets {@link workerJobSets} builds
 *  ({@link import('../content-index.js').ContentIndex.canonicalWorkerJobsByBuilding}). */
export function canonicalWorkerJobLists(
  workerJobs: ReadonlyMap<number, ReadonlySet<number>>,
): ReadonlyMap<number, readonly number[]> {
  const map = new Map<number, readonly number[]>();
  for (const [typeId, jobs] of workerJobs) {
    // Frozen: the array outlives every tick, so an in-place sort by a caller would corrupt slot order.
    map.set(typeId, Object.freeze([...jobs].sort((a, b) => a - b)));
  }
  return map;
}

/** The per-type stored-good sets ({@link import('../content-index.js').ContentIndex.storedGoodsByBuilding});
 *  first-wins per typeId, types with no stock slots omitted (an employed gatherer there stays unrestricted). */
export function storedGoodSets(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const map = new Map<number, ReadonlySet<number>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId) || b.stock.length === 0) continue;
    map.set(b.typeId, new Set(b.stock.map((s) => s.goodType)));
  }
  return map;
}

/** The per-type per-good stock-slot capacities
 *  ({@link import('../content-index.js').ContentIndex.stockSlotCapacityByBuilding}) — first-wins per
 *  typeId AND per good within a type (matching the `.find` scan it replaces); types with no stock
 *  slots omitted. */
export function stockSlotCapacityTables(
  content: ContentSet,
): ReadonlyMap<number, ReadonlyMap<number, number>> {
  const map = new Map<number, ReadonlyMap<number, number>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId) || b.stock.length === 0) continue;
    const slots = new Map<number, number>();
    for (const s of b.stock) {
      if (!slots.has(s.goodType)) slots.set(s.goodType, s.capacity);
    }
    map.set(b.typeId, slots);
  }
  return map;
}
