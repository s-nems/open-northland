import type { ContentSet, ProductionInput, Recipe } from '@vinland/data';
import { Building, Position, Settler, Stockpile, stockpileEntries } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { ONE, fx } from '../fixed.js';
import type { TerrainGraph } from '../terrain.js';
import type { SystemContext } from './context.js';

// The genuinely cross-system helpers, kept in a leaf module so every per-system file imports them
// from here (never from the barrel or from each other) — this breaks the import cycles the
// systems/ split would otherwise create. See docs/TECH-DEBT.md.

/**
 * The per-good capacity of a store's stockpile, from its building type's stock slots. A good with no
 * declared slot has no room (capacity 0); a store with no Building/type is treated as uncapped so a
 * test fixture without a building still accepts deposits.
 *
 * Cross-system: used by the AI store scan ({@link nearestStoreFor}), the atomic `pileup` deposit,
 * and production's `canStartCycle`/`depositOutputs`.
 */
export function stockCapacity(world: World, ctx: SystemContext, store: Entity, goodType: number): number {
  const building = world.tryGet(store, Building);
  if (building === undefined) return Number.MAX_SAFE_INTEGER; // bare store fixture: uncapped
  const type = ctx.content.buildings.find((b) => b.typeId === building.buildingType);
  if (type === undefined) return 0;
  const slot = type.stock.find((s) => s.goodType === goodType);
  return slot?.capacity ?? 0;
}

/**
 * The recipe a building's type declares, or undefined if it has no Building/type or no recipe.
 *
 * Cross-system: the AI uses it to recognise a workplace (haul source / never-deliver-back-to-producer),
 * and ProductionSystem uses it to run the cycle.
 */
export function recipeOf(world: World, ctx: SystemContext, building: Entity): Recipe | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  return type?.recipe;
}

/**
 * The set of job types a building type's `workers` slots name (`logicworker <job> <count>`). Empty
 * if the building has no Building/type or declares no workers (an unstaffed-by-design building — a
 * passive store, or any type without worker slots).
 *
 * Cross-system: the production worker-presence gate ({@link workerPresentAt}) uses it to recognise a
 * settler that may operate the workplace, and the AI planner uses it to recognise a settler standing
 * on a workplace it staffs (so the operator isn't re-planned away).
 */
export function buildingWorkerJobs(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_JOBS;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  if (type === undefined || type.workers.length === 0) return EMPTY_JOBS;
  return new Set(type.workers.map((w) => w.jobType));
}

const EMPTY_JOBS: ReadonlySet<number> = new Set<number>();

/**
 * Whether a workplace is staffed *right now*: some {@link Settler} whose `jobType` matches one of the
 * building type's `workers` slots is standing on the workplace's tile. This is the production
 * worker-presence model — a workplace only produces while its worker is present, like the original
 * (a sawmill with no operator makes no planks).
 *
 * A building type that declares **no** worker slots is unstaffed-by-design and counts as always
 * present (passive stores / fixtures without workers keep working) — the gate constrains only a
 * workplace that actually names a worker. Presence is integer-tile coincidence (settler tile ==
 * building tile), so it needs no terrain graph and works on a mapless fixture too. The match is
 * canonical-order-independent (a boolean any-match, not a chosen entity), so no determinism concern.
 *
 * Cross-system: ProductionSystem gates both starting and advancing a cycle on this.
 */
export function workerPresentAt(world: World, ctx: SystemContext, building: Entity): boolean {
  const jobs = buildingWorkerJobs(world, ctx, building);
  if (jobs.size === 0) return true; // unstaffed-by-design: no worker requirement to satisfy
  const bp = world.tryGet(building, Position);
  if (bp === undefined) return false; // a placed-but-position-less workplace can't be stood on
  const bx = fx.toInt(bp.x);
  const by = fx.toInt(bp.y);
  for (const e of world.query(Settler, Position)) {
    const settler = world.get(e, Settler);
    if (settler.jobType === null || !jobs.has(settler.jobType)) continue;
    const p = world.get(e, Position);
    if (fx.toInt(p.x) === bx && fx.toInt(p.y) === by) return true;
  }
  return false;
}

/**
 * Whether a good is **edible** — the food a hungry settler consumes to reset its hunger (the `eat`
 * atomic's target good). In the original, the eat slot (`setatomic <job> 10 "..._eat_slot_food"`)
 * consumes the `food_simple`/`food_extra` goods (`goodtypes.ini` types 16/17); there is no explicit
 * "iseatable" flag in `goodtypes.ini`, so the slot-food goods are identified by the good's `id`
 * carrying the `food` prefix (the source's own naming — `food_simple`/`food_extra`). (`potion_food_*`
 * are a separate potion-consumable mechanic, not the eat slot, so the `food_`-prefix match excludes
 * them by construction.)
 *
 * FIDELITY (approximated — see docs/FIDELITY.md): the eat atomic id (10) is pinned to the original's
 * `setatomic` bindings, but *which goods feed* is inferred from the slug rather than a source flag
 * (the original maps the food goods to the eat slot at a level not in the readable rule files). Refine
 * to a content flag if the slot→good binding is later decoded. Cross-system: the AI eat-drive planner
 * uses it to find food (carried or stored); the AtomicSystem consumes one unit on completion.
 */
export function isFood(ctx: SystemContext, goodType: number): boolean {
  const good = ctx.content.goods.find((g) => g.typeId === goodType);
  if (good === undefined) return false;
  return good.id.startsWith('food_');
}

/**
 * The **housing capacity** a `tribe` currently has: the sum of the `homeSize` of its placed, fully
 * **built** `home` buildings. This is the sim's first consumer of the extracted `homeSize` param
 * (the original `logichousetype` `logichomesize` — the population a residence shelters: home level
 * 00 → 1, ... level 04 → 5). It is the ceiling the population grows into — the housing half of the
 * roadmap's `house leveling → population capacity → births→housing→births` loop, the number the
 * ReproductionSystem will gate births on (a tribe can only grow while it has room).
 *
 * Only a **built** residence counts (`built >= ONE`): a home still under construction shelters no
 * one yet (the slice places buildings already built, but the ConstructionSystem will start them at
 * `built = 0`, so the gate is forward-compatible). A `home`-kind building type with no `homeSize`
 * (none in the real data, but the schema defaults it to 0) contributes nothing.
 *
 * FIDELITY: the per-home capacity is the extracted `homeSize` param — faithful by construction; what
 * the capacity *gates* (births) is a later mechanic. Determinism: a pure sum over buildings (addition
 * commutes, so the `query` store order can't change the total — no canonical sort needed); no
 * RNG/wall-clock. A building whose type is absent from content contributes nothing.
 */
export function housingCapacity(world: World, ctx: SystemContext, tribe: number): number {
  let capacity = 0;
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.tribe !== tribe || b.built < ONE) continue; // wrong tribe, or not yet built — shelters no one
    const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
    if (type === undefined || type.kind !== 'home') continue; // not a residence
    capacity += type.homeSize;
  }
  return capacity;
}

/**
 * The current **population** of a `tribe`: the number of its living {@link Settler}s. The other half
 * of the housing read model ({@link housingCapacity} is the ceiling): the ReproductionSystem gates a
 * birth on `population < housingCapacity`, and a future "population vs housing capacity" invariant
 * compares the two. Counts every settler regardless of job (idle settlers are still mouths to house).
 *
 * Determinism: a pure count over `query(Settler)` (addition commutes — a count is order-independent,
 * so the store-order traversal is fine, like {@link workerPresentAt}'s any-match); no RNG/wall-clock.
 */
export function tribePopulation(world: World, tribe: number): number {
  let count = 0;
  for (const e of world.query(Settler)) {
    if (world.get(e, Settler).tribe === tribe) count++;
  }
  return count;
}

/**
 * The **per-job-type head-count** of a `tribe`'s settlers — the HUD's *jobs* read view (the third
 * derived view after {@link tribeStocks} and {@link tribePopulation}). Counts each living
 * {@link Settler} keyed by its current `jobType`, so a consumer can show "3 farmers, 2 carpenters,
 * 5 babies, 4 idle". An **idle, job-seeking adult** (`jobType === null` — not yet assigned a trade,
 * not a born age class) is counted under the {@link IDLE_JOB} key so it is visible without colliding
 * with any real job id; every other entry's key is a real `JobType.typeId`.
 *
 * The **age-classes-vs-trades** split the HUD wants is a property of the *keys*, not of this view:
 * keys 1–4 are the non-working baby/child stages (`isNonWorkingAge` in `systems/ageclass.ts`), key 5
 * (`woman`) and up are adult roles, and `null`/{@link IDLE_JOB} is an unassigned adult — so a panel
 * partitions the returned map by classifying each key, exactly as the source models life-stage as a
 * `jobType`. This view does not pre-split, to stay a single faithful "settlers by job" tally that
 * any grouping can read.
 *
 * FIDELITY n/a: a pure derived **read view** of existing sim state, like {@link tribeStocks} — it
 * adds no mechanic (nothing is produced/consumed/moved), so there is no original behavior to pin; the
 * `jobType`s it tallies are set by the already-faithful birth/growth/job-assignment systems.
 *
 * Determinism: a `Map`-valued **read view**, not a game decision — the per-job *counts* are
 * order-independent (addition commutes, so the Settler-store traversal order can't change a tally), so
 * the values are identical run-to-run. The returned Map's *iteration* order is insertion order
 * (store-traversal-dependent); a consumer needing a stable display order sorts the keys itself (the
 * same rule {@link tribeStocks} follows). No RNG/wall-clock.
 */
export function tribePopulationByJob(world: World, tribe: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of world.query(Settler)) {
    const settler = world.get(e, Settler);
    if (settler.tribe !== tribe) continue;
    const key = settler.jobType ?? IDLE_JOB;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The {@link tribePopulationByJob} map key for an **idle, job-seeking adult** (`Settler.jobType ===
 * null`). It is `-1`, outside the valid `JobType.typeId` space (real ids are positive — the first
 * record, `baby_female`, is id 1; see `systems/ageclass.ts`), so it can never collide with a real
 * job's count. A negative sentinel rather than `0`, because `0` is a legitimate `JobType` id (`none`).
 */
export const IDLE_JOB = -1;

/**
 * The **total stock of each good** a `tribe` holds across all its stores — the goods half of the HUD's
 * read model (`tribePopulation` is the population half). A "store" here is any {@link Building} (which
 * carries the owning `tribe`) bearing a {@link Stockpile}; every placed building gets one (seeded from
 * its type's `stock` slots), so this spans warehouses, workplaces, and residences alike — the whole
 * settlement's larder, exactly what a stocks panel shows.
 *
 * Returned as a `Map<goodType, total>` built by walking each store's canonical {@link stockpileEntries}
 * (ascending goodType) and summing per good. A good with no stock anywhere is simply absent from the
 * map (the HUD shows 0 / omits it); a zero entry that a store happens to carry is kept (it is real
 * capacity holding nothing) — callers that want only non-empty goods filter on the value.
 *
 * FIDELITY n/a: a pure derived **read view** of existing sim state, like {@link tribePopulation} — it
 * adds no mechanic (nothing is produced/consumed/moved), so there is no original behavior to pin; the
 * stocks it reads are produced by the already-faithful production/carry loops.
 *
 * Determinism: a `Map`-valued **read view**, not a game decision — the per-good *sums* are
 * order-independent (addition commutes, so the store-traversal order can't change a total), and each
 * store is summed via `stockpileEntries` (canonical), so the values are identical run-to-run. The
 * returned Map's *iteration* order is insertion order (store-traversal-dependent); a consumer that
 * needs a stable display order must sort by goodType itself (the same rule {@link Stockpile} follows).
 * No RNG/wall-clock.
 */
export function tribeStocks(world: World, tribe: number): Map<number, number> {
  const totals = new Map<number, number>();
  for (const e of world.query(Building, Stockpile)) {
    if (world.get(e, Building).tribe !== tribe) continue;
    for (const [goodType, amount] of stockpileEntries(world.get(e, Stockpile))) {
      totals.set(goodType, (totals.get(goodType) ?? 0) + amount);
    }
  }
  return totals;
}

/**
 * A single node of the {@link goodsGraph} — one good's place in the recipe-DAG: its node *layer*
 * (raw vs produced, from the good's classification flags), the inputs **one production cycle**
 * consumes to make it (the input side, from `GoodType.productionInputs`), and which building **types**
 * make it (the output side, joined from each building type's `produces`/`recipe.outputs`).
 */
export interface GoodsGraphNode {
  /**
   * The good's tier in the graph: `'raw'` = harvested from the map (`classification.producedOnMap`,
   * e.g. wood/stone/wheat — no recipe), `'produced'` = made in a workplace
   * (`classification.producedInHouse`, e.g. plank/flour/bread). `'unclassified'` covers a good the
   * source marks as neither (the `none`/sentinel good, or a good whose flags default off) — it is
   * still a node so an edge can point at it. A good flagged *both* (none are in the real data) is
   * reported as `'produced'` (the in-house tier wins, since it has a recipe).
   */
  layer: 'raw' | 'produced' | 'unclassified';
  /** Whether this good can be **consumed** as a recipe input somewhere (`classification.inputGood`). */
  inputGood: boolean;
  /** The goods (+ per-cycle amounts) one cycle consumes to make this good — empty for a raw good. */
  inputs: readonly ProductionInput[];
  /**
   * The building **type ids** that produce this good, ascending — the output side of the join. A good
   * with no producer (a raw good, or one nothing makes) has an empty list. Type ids, not entities:
   * this is a static read over `content`, independent of what is placed in any world.
   */
  producedBy: readonly number[];
}

/**
 * The **goods graph** as a derived **read view** over `content` — the HUD's *goods-graph* panel
 * (the fourth derived view after {@link tribeStocks}, {@link tribePopulation}, and
 * {@link tribePopulationByJob}, and the only one over content rather than world state). It surfaces
 * the recipe-DAG the pipeline already extracted as IR — `GoodType.productionInputs` (the input-side
 * edges) + `GoodType.classification` (the raw/produced/input node layers) — joined with the
 * **output side**: which building types make each good (`BuildingType.produces`, falling back to a
 * `recipe`'s `outputs` when `produces` is empty). The result is one {@link GoodsGraphNode} per good,
 * so a panel can draw "wood (raw) → sawmill → plank (produced) → …" without re-walking content.
 *
 * Returned as a `Map<goodType, GoodsGraphNode>` keyed by `GoodType.typeId`, one entry per good in
 * `content.goods`. The `producedBy` list is sorted ascending so the view is stable regardless of
 * building declaration order; the input edges keep their `productionInputs` order (already the
 * source's). Every good gets a node even if nothing produces or consumes it, so an edge always has
 * both endpoints present.
 *
 * FIDELITY n/a: a pure derived **read view** of the already-extracted goods-graph IR, like
 * {@link tribeStocks} — it adds no mechanic (nothing is produced/consumed/moved) and invents no
 * data; the layers/edges it surfaces are the faithful `classification`/`productionInputs` params the
 * pipeline pinned (see ROADMAP Phase 3 "Goods graph").
 *
 * Determinism: a pure function of `content` (no world, no RNG, no wall-clock) — but `content.goods`
 * is a plain array and the `producedBy` list is explicitly **sorted**, so the same content yields a
 * byte-identical map every call. The returned Map's iteration order is `content.goods` order (a
 * stable array), so even iteration is reproducible here (unlike the world-state read views, whose Map
 * order is store-traversal-dependent).
 */
export function goodsGraph(content: ContentSet): Map<number, GoodsGraphNode> {
  // Output side: for each good, the building type ids that make it. Prefer `produces` (the
  // output-good list the original house table names directly); fall back to a recipe's `outputs`
  // for a building that carries a materialized recipe but no `produces` (e.g. a test fixture).
  const producers = new Map<number, number[]>();
  for (const building of content.buildings) {
    const outputs =
      building.produces.length > 0
        ? building.produces
        : (building.recipe?.outputs.map((o) => o.goodType) ?? []);
    for (const goodType of outputs) {
      const list = producers.get(goodType);
      if (list === undefined) producers.set(goodType, [building.typeId]);
      else if (!list.includes(building.typeId)) list.push(building.typeId);
    }
  }

  const graph = new Map<number, GoodsGraphNode>();
  for (const good of content.goods) {
    const c = good.classification;
    const layer = c.producedInHouse ? 'produced' : c.producedOnMap ? 'raw' : 'unclassified';
    graph.set(good.typeId, {
      layer,
      inputGood: c.inputGood,
      inputs: good.productionInputs,
      producedBy: (producers.get(good.typeId) ?? []).sort((a, b) => a - b),
    });
  }
  return graph;
}

/**
 * Whether a building is a **temple** — the satisfier site for the piety need (where a settler runs
 * the `pray` atomic). The original's "work temple" (`logichousetype` `logictype 37`, the
 * `HOUSE_TYPE_WORK_TEMPLE` constant) is a `logicmaintype 3` workplace that, unlike a real production
 * workplace, declares **no `logicworker`, no `logicstock`, no `logicproduction`** — so it surfaces in
 * the IR as `kind === 'workplace'` with an empty `workers`, empty `stock`, and **no `recipe`**. That
 * "workplace with nothing to make and no one to staff it" shape is how a temple is told apart from a
 * sawmill/mill (which always carry a recipe + workers).
 *
 * FIDELITY (approximated — see docs/FIDELITY.md): the temple→pray need→satisfier link lives below the
 * readable rule files (the original binds the religious building to the pray slot at the engine level,
 * not in `houses.ini`), so the satisfier is *inferred* from this structural signature — exactly like
 * the food→eat-slot binding ({@link isFood}) is inferred from the `food_` id prefix. Refine to a
 * content flag if the building→need binding is later decoded. Cross-system: the AI pray-drive planner
 * uses it to find the nearest temple to walk to.
 */
export function isTemple(world: World, ctx: SystemContext, building: Entity): boolean {
  const b = world.tryGet(building, Building);
  if (b === undefined) return false;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  if (type === undefined) return false;
  return type.kind === 'workplace' && type.recipe === undefined && type.workers.length === 0;
}

/**
 * Whether a raw cell id is a valid index into the terrain graph (`0..cellCount-1`, integer). A
 * request/goal id outside the grid is boundary input — callers treat it as "no route" rather than
 * letting it throw inside the search.
 *
 * Cross-system: used by the AI navigation planner (drop an off-map goal) and the pathfinding system
 * (guard the A* endpoints).
 */
export function inRange(terrain: TerrainGraph, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < terrain.cellCount;
}
