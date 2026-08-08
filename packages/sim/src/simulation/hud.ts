import type { ContentSet, ProductionInput } from '@open-northland/data';
import { Building, Person, Settler, Stockpile, stockpileEntries } from '../components/index.js';
import { contentIndex } from '../core/content-index.js';
import { ONE } from '../core/fixed.js';
import type { World } from '../ecs/world.js';
import type { SystemContext } from '../systems/context.js';

// Tribe-scoped read views. Nothing here may feed a sim decision, so `systems/` must not import this
// module.
// The returned Maps iterate in insertion order; a consumer needing a stable display order sorts the keys.

/**
 * The summed `homeSize` of a tribe's built `home` buildings (the `logichousetype` `logichomesize` param,
 * home level 00 = 1 up to level 04 = 5). A ceiling to display beside a head-count; births are gated per
 * home by its family slots. Tribe-scoped, so it sums across every seat fielding that tribe.
 */
export function housingCapacity(world: World, ctx: SystemContext, tribe: number): number {
  let capacity = 0;
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.tribe !== tribe || b.built < ONE) continue;
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined || type.kind !== 'home') continue;
    capacity += type.homeSize;
  }
  return capacity;
}

/** The number of a tribe's living {@link Person}s, regardless of job. */
export function tribePopulation(world: World, tribe: number): number {
  let count = 0;
  for (const e of world.query(Person)) {
    if (world.get(e, Settler).tribe === tribe) count++;
  }
  return count;
}

/**
 * The per-job-type head-count of a tribe's settlers. An idle, job-seeking adult (`jobType === null`) is
 * counted under {@link IDLE_JOB}; every other key is a `JobType.typeId`. The source models life stage as a
 * job type, so keys 1-4 are the non-working baby and child stages and key 5 (`woman`) up are adult roles;
 * a panel classifies the keys itself.
 */
export function tribePopulationByJob(world: World, tribe: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of world.query(Person)) {
    const settler = world.get(e, Settler);
    if (settler.tribe !== tribe) continue;
    const key = settler.jobType ?? IDLE_JOB;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The {@link tribePopulationByJob} key for an idle adult. Negative rather than `0`, which is the legitimate
 * `none` job id.
 */
export const IDLE_JOB = -1;

/**
 * The total stock of each good a tribe holds across every {@link Building} bearing a {@link Stockpile}.
 * A zero entry means a store carries the good but holds none; a good stocked nowhere is absent.
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

/** One good's place in the recipe DAG. */
interface GoodsGraphNode {
  /**
   * `'raw'` is `classification.producedOnMap`, `'produced'` is `classification.producedInHouse`, and
   * `'unclassified'` is neither. A good flagged both reads as `'produced'`, since it has a recipe.
   */
  layer: 'raw' | 'produced' | 'unclassified';
  /** Whether this good can be consumed as a recipe input somewhere (`classification.inputGood`). */
  inputGood: boolean;
  /** The goods and per-cycle amounts one cycle consumes to make this good; empty for a raw good. */
  inputs: readonly ProductionInput[];
  /** The building type ids that produce this good, ascending. A static read over `content`, not a world. */
  producedBy: readonly number[];
}

/**
 * The recipe DAG from `GoodType.productionInputs` and `GoodType.classification`, joined with which building
 * types make each good. Every good in `content.goods` gets a node, so an edge always has both endpoints.
 */
export function goodsGraph(content: ContentSet): Map<number, GoodsGraphNode> {
  // `produces` is the output-good list the original house table names directly; a building with only a
  // materialized recipe falls back to the recipe's `outputs`.
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
