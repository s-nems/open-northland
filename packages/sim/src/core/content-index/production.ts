import type { ContentSet, Recipe } from '@open-northland/data';
import { harvestCapableJobs } from './atomics.js';
import { isCarrierJobId } from './jobs.js';

/** The per-building-type `product → recipe` tables, first-wins per typeId and per product; a recipe's
 *  product key is its first output's goodType. Types without recipes are absent.
 *
 *  At a livestock workplace an input-less recipe is the original's slaughter production (`breeder_slay_*`
 *  atomics), and it is dropped here: the one home of the authored no-slaughter rule, under which food
 *  arrives as the feed-cycle meat byproduct instead. A type whose every recipe was dropped is absent. */
export function recipeProductTables(
  content: ContentSet,
  livestockWorkplaces: ReadonlySet<number>,
): ReadonlyMap<number, ReadonlyMap<number, Recipe>> {
  const map = new Map<number, ReadonlyMap<number, Recipe>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId) || b.recipes.length === 0) continue;
    const feeds = livestockWorkplaces.has(b.typeId);
    const byProduct = new Map<number, Recipe>();
    for (const recipe of b.recipes) {
      if (feeds && recipe.inputs.length === 0) continue; // the slaughter production - see above
      const product = recipe.outputs[0]?.goodType;
      if (product !== undefined && !byProduct.has(product)) byProduct.set(product, recipe);
    }
    if (byProduct.size > 0) map.set(b.typeId, byProduct);
  }
  return map;
}

/** The union view over `recipes`: inputs summed per goodType and outputs merged per goodType, both
 *  ascending; `ticks` is the max (a union never times a cycle, but the field is required). */
export function mergeRecipes(recipes: readonly Recipe[]): Recipe {
  const inputs = new Map<number, number>();
  const outputs = new Map<number, number>();
  let ticks = 1;
  for (const recipe of recipes) {
    for (const io of recipe.inputs) inputs.set(io.goodType, (inputs.get(io.goodType) ?? 0) + io.amount);
    for (const io of recipe.outputs) outputs.set(io.goodType, (outputs.get(io.goodType) ?? 0) + io.amount);
    if (recipe.ticks > ticks) ticks = recipe.ticks;
  }
  const lines = (m: Map<number, number>) =>
    [...m].sort(([a], [c]) => a - c).map(([goodType, amount]) => ({ goodType, amount }));
  return { inputs: lines(inputs), outputs: lines(outputs), ticks };
}

/** The per-building-type union recipes, the single-recipe view the supply AI plans against. First-wins
 *  per typeId. */
export function mergedRecipes(content: ContentSet): ReadonlyMap<number, Recipe> {
  const map = new Map<number, Recipe>();
  for (const b of content.buildings) {
    if (map.has(b.typeId) || b.recipes.length === 0) continue;
    map.set(b.typeId, mergeRecipes(b.recipes));
  }
  return map;
}

/**
 * `goodType → the building typeIds a consumer self-serves it from` - the shared unstaffed utilities that
 * mint a good from no inputs (the well drawing water, the hive drawing honey). A type qualifies only
 * when it has a recipe producing the good with no inputs and every worker slot is a carrier or gatherer
 * rather than an operator trade, which excludes a staffed input-less producer like the animal farm.
 * First-wins per typeId.
 */
export function inputlessProducerTypes(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const carrierJobs = new Set(content.jobs.filter((j) => isCarrierJobId(j.id)).map((j) => j.typeId));
  const harvestJobs = harvestCapableJobs(content);
  const isOperatorSlot = (jobType: number): boolean => !carrierJobs.has(jobType) && !harvestJobs.has(jobType);
  const map = new Map<number, Set<number>>();
  const seen = new Set<number>();
  for (const b of content.buildings) {
    if (seen.has(b.typeId)) continue;
    seen.add(b.typeId);
    if (b.workers.some((w) => isOperatorSlot(w.jobType))) continue; // staffed - not a self-service tap
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

/** The per-building-type worker-job sets - first-wins per typeId unconditionally, so a first record with
 *  zero workers claims the key with an empty set and a later duplicate cannot shadow it. */
export function workerJobSets(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const map = new Map<number, ReadonlySet<number>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId)) continue;
    map.set(b.typeId, new Set(b.workers.map((w) => w.jobType)));
  }
  return map;
}

/** The per-type stored-good sets; first-wins per typeId, types with no stock slots omitted, where an
 *  employed gatherer stays unrestricted. */
export function storedGoodSets(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const map = new Map<number, ReadonlySet<number>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId) || b.stock.length === 0) continue;
    map.set(b.typeId, new Set(b.stock.map((s) => s.goodType)));
  }
  return map;
}

/** The per-type per-good stock-slot capacities - first-wins per typeId and per good within a type;
 *  types with no stock slots omitted. */
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
