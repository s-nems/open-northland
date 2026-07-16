import type { ContentSet, ProductionInput } from '@open-northland/data';
import { Building, Settler, Stockpile, stockpileEntries } from '../../components/index.js';
import type { World } from '../../ecs/world.js';

// Pure, terminal read views for the HUD — derived projections of world state or `content` that the HUD, the
// renderer, and tests consume but no sim system mutates or feeds back into a decision. See ./index.ts for how
// read views relate to systems.
//
// The world-state views below return `Map`s whose *values* are order-independent tallies (addition commutes,
// so store-traversal order can't change a total) but whose *iteration* order is insertion order; a consumer
// needing a stable display order sorts the keys itself.

/**
 * The per-job-type head-count of a `tribe`'s settlers, keyed by each living {@link Settler}'s current
 * `jobType`, so a consumer can show "3 farmers, 2 carpenters, 5 babies, 4 idle". An idle, job-seeking adult
 * (`jobType === null`) is counted under {@link IDLE_JOB} so it is visible without colliding with any real job
 * id; every other key is a real `JobType.typeId`.
 *
 * The age-classes-vs-trades split the HUD wants is a property of the keys, not of this view: keys 1–4 are the
 * non-working baby/child stages (`isNonWorkingAge` in `systems/ageclass.ts`), key 5 (`woman`) and up are adult
 * roles. A panel partitions the map by classifying each key, exactly as the source models life-stage as a
 * `jobType`; this view stays a single "settlers by job" tally that any grouping can read.
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
 * The {@link tribePopulationByJob} map key for an idle, job-seeking adult (`Settler.jobType === null`). It is
 * `-1`, outside the valid `JobType.typeId` space (real ids are positive — the first record, `baby_female`, is
 * id 1), so it can never collide with a real job's count. A negative sentinel rather than `0`, because `0` is
 * a legitimate `JobType` id (`none`).
 */
export const IDLE_JOB = -1;

/**
 * The total stock of each good a `tribe` holds across all its stores. A "store" here is any {@link Building}
 * (which carries the owning `tribe`) bearing a {@link Stockpile}; every placed building gets one (seeded from
 * its type's `stock` slots), so this spans warehouses, workplaces, and residences alike — the whole
 * settlement's larder.
 *
 * Built by walking each store's canonical {@link stockpileEntries} (ascending goodType) and summing per good.
 * A good with no stock anywhere is absent from the map; a zero entry a store happens to carry is kept (it is
 * real capacity holding nothing), so callers wanting only non-empty goods filter on the value.
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
 * A single node of the {@link goodsGraph} — one good's place in the recipe-DAG: its node layer (raw vs
 * produced, from the good's classification flags), the inputs one production cycle consumes to make it
 * (`GoodType.productionInputs`), and which building types make it (joined from each building type's
 * `produces`/`recipe.outputs`).
 */
export interface GoodsGraphNode {
  /**
   * The good's tier in the graph: `'raw'` = harvested from the map (`classification.producedOnMap`, e.g.
   * wood/stone/wheat — no recipe), `'produced'` = made in a workplace (`classification.producedInHouse`,
   * e.g. plank/flour/bread). `'unclassified'` covers a good the source marks as neither (the `none`/sentinel
   * good, or a good whose flags default off) — it is still a node so an edge can point at it. A good flagged
   * both (none are in the real data) is reported as `'produced'`, since it has a recipe.
   */
  layer: 'raw' | 'produced' | 'unclassified';
  /** Whether this good can be consumed as a recipe input somewhere (`classification.inputGood`). */
  inputGood: boolean;
  /** The goods (+ per-cycle amounts) one cycle consumes to make this good — empty for a raw good. */
  inputs: readonly ProductionInput[];
  /**
   * The building type ids that produce this good, ascending — the output side of the join. A good with no
   * producer (a raw good, or one nothing makes) has an empty list. Type ids, not entities: this is a static
   * read over `content`, independent of what is placed in any world.
   */
  producedBy: readonly number[];
}

/**
 * The goods graph as a derived read view over `content` — the recipe-DAG the pipeline already extracted as IR
 * (`GoodType.productionInputs` for the input edges, `GoodType.classification` for the node layers), joined
 * with the output side: which building types make each good (`BuildingType.produces`, falling back to a
 * `recipe`'s `outputs` when `produces` is empty). One {@link GoodsGraphNode} per good, so a panel can draw
 * "wood (raw) → sawmill → plank (produced) → …" without re-walking content.
 *
 * Keyed by `GoodType.typeId`, one entry per good in `content.goods`. The `producedBy` list is sorted ascending
 * so the view is stable regardless of building declaration order; the input edges keep their
 * `productionInputs` (source) order. Every good gets a node even if nothing produces or consumes it, so an
 * edge always has both endpoints present.
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
        : building.recipes.flatMap((r) => r.outputs.map((o) => o.goodType));
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
