import type { GoodQuantity } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import type { KnowledgeBase, KnowledgeBuilding, KnowledgeGood, KnowledgeRecipe } from './model.js';

export interface RecipeSource {
  readonly building: KnowledgeBuilding;
  readonly recipe: KnowledgeRecipe;
}

/** One batch's length for `tribe`: the produce clip of whichever trade of the house has one, the sim's
 *  own timing, or the row's stand-in. */
export function recipeTicks(
  base: KnowledgeBase,
  building: KnowledgeBuilding,
  recipe: KnowledgeRecipe,
  tribe: number,
): number {
  const good = recipe.madeGood;
  if (good === null) return recipe.fallbackTicks;
  for (const { jobType } of building.workers) {
    const settler = { tribe, jobType };
    const atomic = systems.productionAtomic(base.content, settler, good);
    const length =
      atomic === undefined ? undefined : systems.resolvedAtomicLength(base.content, settler, atomic);
    if (length !== undefined) return length;
  }
  return recipe.fallbackTicks;
}

export type ChainEdgeKind = 'hunt' | 'recipe' | 'slaughter';

/** One input-to-output step of the goods graph, between shown type ids. */
export interface ChainEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: ChainEdgeKind;
}

/** One input a card lists: `alternative` joins it to the previous one with "or" rather than "+". */
export interface BillInput {
  readonly good: KnowledgeGood;
  readonly amount: number;
  readonly alternative: boolean;
}

interface ChainIndex {
  readonly recipes: ReadonlyMap<number, readonly RecipeSource[]>;
  readonly uses: ReadonlyMap<number, readonly RecipeSource[]>;
  readonly edges: readonly ChainEdge[];
  readonly inputs: ReadonlyMap<number, readonly ChainEdge[]>;
  readonly outputs: ReadonlyMap<number, readonly ChainEdge[]>;
}

/** What the hunter's prey yields; no recipe row says so. */
const HUNT_YIELDS: readonly string[] = ['meat', 'leather'];
/** What the farm slaughters for meat; meat's own recipe row names no input. */
const SLAUGHTERED_FOR_MEAT: readonly string[] = ['sheep', 'cattle'];
const PREY = 'prey';
const MEAT = 'meat';

function pushTo<V>(map: Map<number, V[]>, key: number, value: V): void {
  const held = map.get(key);
  if (held === undefined) map.set(key, [value]);
  else held.push(value);
}

/** The bill of a yard-built vehicle good: its yard's construction cost. */
function vehicleBill(base: KnowledgeBase, good: KnowledgeGood): readonly GoodQuantity[] | undefined {
  return good.vehicleHouse === null ? undefined : base.buildingByType.get(good.vehicleHouse)?.cost;
}

function collectEdges(
  base: KnowledgeBase,
  recipes: ReadonlyMap<number, readonly RecipeSource[]>,
): ChainEdge[] {
  const edges: ChainEdge[] = [];
  const seen = new Set<string>();
  const add = (fromType: number, toType: number, kind: ChainEdgeKind): void => {
    const from = base.goodByType.get(fromType)?.typeId;
    const to = base.goodByType.get(toType)?.typeId;
    const key = `${from}>${to}`;
    if (from === undefined || to === undefined || seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind });
  };
  for (const [output, sources] of recipes) {
    for (const input of sources[0]?.recipe.inputs ?? []) add(input.goodType, output, 'recipe');
  }
  for (const good of base.goods) {
    for (const input of good.slaughterInputs) add(input.goodType, good.typeId, 'slaughter');
  }
  for (const good of base.goods) {
    for (const cost of vehicleBill(base, good) ?? []) add(cost.goodType, good.typeId, 'recipe');
  }
  const typeOf = (id: string): number | undefined => base.goodById.get(id)?.typeId;
  const prey = typeOf(PREY);
  const meat = typeOf(MEAT);
  for (const id of HUNT_YIELDS) {
    const yielded = typeOf(id);
    if (prey !== undefined && yielded !== undefined) add(prey, yielded, 'hunt');
  }
  for (const id of SLAUGHTERED_FOR_MEAT) {
    const animal = typeOf(id);
    if (animal !== undefined && meat !== undefined) add(animal, meat, 'slaughter');
  }
  return edges;
}

function buildIndex(base: KnowledgeBase): ChainIndex {
  const recipes = new Map<number, RecipeSource[]>();
  const uses = new Map<number, RecipeSource[]>();
  for (const building of base.buildings) {
    for (const recipe of building.recipes) {
      for (const output of recipe.outputs) pushTo(recipes, output.goodType, { building, recipe });
      for (const input of recipe.inputs) pushTo(uses, input.goodType, { building, recipe });
    }
  }
  const edges = collectEdges(base, recipes);
  const inputs = new Map<number, ChainEdge[]>();
  const outputs = new Map<number, ChainEdge[]>();
  for (const edge of edges) {
    pushTo(inputs, edge.to, edge);
    pushTo(outputs, edge.from, edge);
  }
  return { recipes, uses, edges, inputs, outputs };
}

const indexes = new WeakMap<KnowledgeBase, ChainIndex>();

function chainIndex(base: KnowledgeBase): ChainIndex {
  let index = indexes.get(base);
  if (index === undefined) {
    index = buildIndex(base);
    indexes.set(base, index);
  }
  return index;
}

/** Every way a good comes into being, in building order, so the lowest tier leads. */
export function recipesOf(base: KnowledgeBase, goodType: number): readonly RecipeSource[] {
  return chainIndex(base).recipes.get(goodType) ?? [];
}

/** Every recipe that spends a good. */
export function usesOf(base: KnowledgeBase, goodType: number): readonly RecipeSource[] {
  return chainIndex(base).uses.get(goodType) ?? [];
}

/** The buildings that fill a good with no recipe: the well, the hive, the herb hut, the fisher's store. */
export function producersOf(base: KnowledgeBase, goodType: number): readonly KnowledgeBuilding[] {
  return base.buildings.filter(
    (b) =>
      b.produces.includes(goodType) && !b.recipes.some((r) => r.outputs.some((o) => o.goodType === goodType)),
  );
}

export function buildingsCosting(base: KnowledgeBase, goodType: number): readonly KnowledgeBuilding[] {
  return base.buildings.filter((b) => b.cost.some((c) => c.goodType === goodType));
}

/** The graph's edges, unique per pair: a recipe, a slaughter or a hunt. */
export function edges(base: KnowledgeBase): readonly ChainEdge[] {
  return chainIndex(base).edges;
}

export function inputsOf(base: KnowledgeBase, goodType: number): readonly ChainEdge[] {
  return chainIndex(base).inputs.get(goodType) ?? [];
}

export function outputsOf(base: KnowledgeBase, goodType: number): readonly ChainEdge[] {
  return chainIndex(base).outputs.get(goodType) ?? [];
}

function walk(start: number, neighbours: (goodType: number) => readonly number[]): Set<number> {
  const found = new Set<number>();
  const stack = [start];
  for (let type = stack.pop(); type !== undefined; type = stack.pop()) {
    for (const next of neighbours(type)) {
      if (!found.has(next)) {
        found.add(next);
        stack.push(next);
      }
    }
  }
  return found;
}

export function upstreamOf(base: KnowledgeBase, goodType: number): ReadonlySet<number> {
  return walk(goodType, (type) => inputsOf(base, type).map((e) => e.from));
}

export function downstreamOf(base: KnowledgeBase, goodType: number): ReadonlySet<number> {
  return walk(goodType, (type) => outputsOf(base, type).map((e) => e.to));
}

/** What one unit is made of: a yard's cost for a vehicle, else its first recipe's inputs. */
function directBill(base: KnowledgeBase, goodType: number): readonly GoodQuantity[] {
  const good = base.goodByType.get(goodType);
  const bill =
    good === undefined || good.vehicleHouse === null
      ? recipesOf(base, goodType)[0]?.recipe.inputs
      : vehicleBill(base, good);
  return bill ?? [];
}

/** Raw materials one unit costs through each good's first recipe, stopping where no recipe exists. */
export function rawCost(base: KnowledgeBase, goodType: number): ReadonlyMap<number, number> {
  const into = new Map<number, number>();
  const add = (type: number, times: number): void => {
    const bill = directBill(base, type);
    if (bill.length === 0) into.set(type, (into.get(type) ?? 0) + times);
    for (const input of bill) add(input.goodType, times * input.amount);
  };
  add(goodType, 1);
  return into;
}

/** The inputs a tree card lists: the bill, or for a good with none the alternatives feeding it. */
export function billOf(base: KnowledgeBase, good: KnowledgeGood): readonly BillInput[] {
  const shown = (goodType: number, amount: number, alternative: boolean): BillInput[] => {
    const input = base.goodByType.get(goodType);
    return input === undefined ? [] : [{ good: input, amount, alternative }];
  };
  const bill = directBill(base, good.typeId);
  if (bill.length > 0) return bill.flatMap((i) => shown(i.goodType, i.amount, false));
  return inputsOf(base, good.typeId).flatMap((edge, index) => shown(edge.from, 1, index > 0));
}

/** Who brings a raw good in, since it has no recipe: the building that fills it, else its first trade. */
export function sourceNameOf(base: KnowledgeBase, good: KnowledgeGood): string {
  return producersOf(base, good.typeId)[0]?.name ?? base.gatheredBy.get(good.typeId)?.[0]?.name ?? '';
}
