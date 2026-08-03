import type { ContentSet, ProductionInput } from '@open-northland/data';
import { Building, Settler, Stockpile, stockpileEntries } from '../components/index.js';
import { contentIndex } from '../core/content-index.js';
import { ONE } from '../core/fixed.js';
import type { World } from '../ecs/world.js';
import type { SystemContext } from '../systems/context.js';

// Read views for the HUD: projections of world state or `content` that no sim system may read. Nothing
// here may feed a decision, so `systems/` must not import this module.
//
// The Maps returned below hold order-independent tallies but iterate in insertion order; a consumer needing
// a stable display order sorts the keys itself.

/**
 * The housing capacity a `tribe` currently has: the summed `homeSize` of its placed, built `home` buildings
 * (the extracted `logichousetype` `logichomesize` param, home level 00 = 1 up to level 04 = 5). A home still
 * under construction shelters no one yet, and a `home` type with no `homeSize` contributes nothing.
 *
 * This is the ceiling half of the HUD readout only; births are gated per home by its family slots.
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

/** The number of a `tribe`'s living {@link Settler}s, regardless of job - idle settlers are still mouths to
 *  house. The count half of the readout {@link housingCapacity} is the ceiling for. */
export function tribePopulation(world: World, tribe: number): number {
  let count = 0;
  for (const e of world.query(Settler)) {
    if (world.get(e, Settler).tribe === tribe) count++;
  }
  return count;
}

/**
 * The per-job-type head-count of a `tribe`'s settlers. An idle, job-seeking adult (`jobType === null`) is
 * counted under {@link IDLE_JOB}; every other key is a real `JobType.typeId`.
 *
 * The age-class-vs-trade split is a property of the keys, not of this view: keys 1-4 are the non-working
 * baby and child stages, key 5 (`woman`) and up are adult roles, exactly as the source models life stage as
 * a `jobType`. A panel classifies the keys itself.
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
 * The {@link tribePopulationByJob} key for an idle, job-seeking adult (`Settler.jobType === null`). Outside
 * the valid `JobType.typeId` space, whose first record `baby_female` is id 1; negative rather than `0`,
 * since `0` is the legitimate `none` job id.
 */
export const IDLE_JOB = -1;

/**
 * The total stock of each good a `tribe` holds across every {@link Building} bearing a {@link Stockpile}, so
 * warehouses, workplaces and residences alike.
 *
 * A good stocked nowhere is absent from the map, but a zero entry a store carries is kept, since that is
 * real capacity holding nothing; a caller wanting only non-empty goods filters on the value.
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
   * `'raw'` is harvested from the map (`classification.producedOnMap`), `'produced'` is made in a workplace
   * (`classification.producedInHouse`). `'unclassified'` is a good the source marks as neither, still a node
   * so an edge can point at it; a good flagged both reads as `'produced'`, since it has a recipe.
   */
  layer: 'raw' | 'produced' | 'unclassified';
  /** Whether this good can be consumed as a recipe input somewhere (`classification.inputGood`). */
  inputGood: boolean;
  /** The goods and per-cycle amounts one cycle consumes to make this good; empty for a raw good. */
  inputs: readonly ProductionInput[];
  /** The building type ids that produce this good, ascending. Type ids, not entities: a static read over
   *  `content`, independent of what is placed in any world. */
  producedBy: readonly number[];
}

/**
 * The recipe DAG the pipeline extracted as IR (`GoodType.productionInputs` for the input edges,
 * `GoodType.classification` for the node layers), joined with the output side: which building types make
 * each good.
 *
 * Every good in `content.goods` gets a node even if nothing produces or consumes it, so an edge always has
 * both endpoints present. `producedBy` is sorted ascending so the view is stable regardless of building
 * declaration order; the input edges keep their source order.
 */
export function goodsGraph(content: ContentSet): Map<number, GoodsGraphNode> {
  // Prefer `produces`, the output-good list the original house table names directly; a building carrying a
  // materialized recipe but no `produces` falls back to the recipe's `outputs`.
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
