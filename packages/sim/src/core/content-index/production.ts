import type { ContentSet, Recipe } from '@open-northland/data';
import { harvestCapableJobs } from './atomics.js';
import { isCarrierJobId } from './jobs.js';

/** The per-building-type `product → recipe` tables, first-wins per typeId and per product; a recipe's
 *  product key is its first output's goodType. Types without recipes are absent. */
export function recipeProductTables(content: ContentSet): ReadonlyMap<number, ReadonlyMap<number, Recipe>> {
  const map = new Map<number, ReadonlyMap<number, Recipe>>();
  for (const b of content.buildings) {
    if (map.has(b.typeId) || b.recipes.length === 0) continue;
    const byProduct = new Map<number, Recipe>();
    for (const recipe of b.recipes) {
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

/** Whether a worker slot's trade operates the craft: any trade but a carrier or a gatherer. Approximation:
 *  the readable data does not say which slot operates the craft. */
function operatorSlotRule(content: ContentSet): (jobType: number) => boolean {
  const carrierJobs = new Set(content.jobs.filter((j) => isCarrierJobId(j.id)).map((j) => j.typeId));
  const harvestJobs = harvestCapableJobs(content);
  return (jobType) => !carrierJobs.has(jobType) && !harvestJobs.has(jobType);
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

/**
 * The per-building-type operator-job sets: the worker slots minus the carrier and gatherer trades, so a
 * gatherer fetching a workshop's raw input never satisfies the production worker-presence gate. A
 * carrier-or-gatherer-only type keeps its whole slot set, since its lone carrier is then its operator.
 * Keyed like {@link workerJobSets}; a type with no worker slots maps to the empty set.
 */
export function operatorJobSets(
  workerJobs: ReadonlyMap<number, ReadonlySet<number>>,
  content: ContentSet,
): ReadonlyMap<number, ReadonlySet<number>> {
  const isOperatorSlot = operatorSlotRule(content);
  const map = new Map<number, ReadonlySet<number>>();
  for (const [typeId, jobs] of workerJobs) {
    const operators = new Set<number>();
    for (const job of jobs) if (isOperatorSlot(job)) operators.add(job);
    map.set(typeId, operators.size > 0 ? operators : jobs);
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
