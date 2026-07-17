import type { ContentSet, Recipe } from '@open-northland/data';

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
