import type { GoodQuantity, Recipe } from '@open-northland/data';
import { Building } from '../../components/index.js';
import { isCarrierJobId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext, SystemContext } from '../context.js';
import { exportedGoodForm } from '../readviews/food.js';

// What a building type declares: its products, job slots, and stored goods. Which slots run the craft
// and who fills them is ./operators.ts.

/**
 * The union of a building type's per-product recipes: inputs summed, one output line per product. An
 * operator fetches against its own rotation's narrower `operatorRecipes` instead.
 */
export function mergedRecipeOf(world: World, ctx: ContentContext, building: Entity): Recipe | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).mergedRecipeByBuilding.get(b.buildingType);
}

/**
 * Whether a fetch may lift `goodType` out of `store`: a workshop's stock of a good its own recipe
 * consumes is the reserve it needs to run, so nobody else may take it. Authored rule, keyed on recipe
 * inputs alone, so a slot no recipe consumes stays strippable and a recipe-less building is untouched.
 */
export function mayFetchGoodFrom(
  world: World,
  ctx: ContentContext,
  store: Entity,
  goodType: number,
): boolean {
  return !recipeConsumes(mergedRecipeOf(world, ctx, store)?.inputs, goodType);
}

/** {@link mayFetchGoodFrom}'s test with the recipe already in hand; undefined inputs mean no recipe. */
export function recipeConsumes(inputs: readonly GoodQuantity[] | undefined, goodType: number): boolean {
  if (inputs === undefined) return false;
  for (const input of inputs) {
    if (input.goodType === goodType) return true;
  }
  return false;
}

/**
 * A building's per-product recipe table keyed by product good type. Iteration follows the type's
 * `recipes` content order, so map order is deterministic.
 */
export function recipesByProductOf(
  world: World,
  ctx: SystemContext,
  building: Entity,
): ReadonlyMap<number, Recipe> | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).recipeByProductByBuilding.get(b.buildingType);
}

/**
 * The goods a building's type produces (`logicproduction`), empty for a passive store. The asset pipeline
 * synthesizes a recipe for every producing building (`fillBuildingRecipes`), so a field producer must be
 * keyed on the good's `farming` block (`farmWorkGood`), never on recipe absence.
 */
export function buildingProduces(world: World, ctx: SystemContext, building: Entity): readonly number[] {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_PRODUCES;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.produces ?? EMPTY_PRODUCES;
}

const EMPTY_PRODUCES: readonly number[] = [];

/**
 * Whether `buildingType` is an unstaffed shared utility that mints `goodType` from no inputs, a well for
 * water or a hive for honey, so a consumer can crank it in place. Data-driven through
 * `inputlessProducersByGood`; a staffed input-less producer does not qualify.
 */
export function typeProducesGoodWithoutInputs(
  ctx: SystemContext,
  buildingType: number,
  goodType: number,
): boolean {
  return contentIndex(ctx.content).inputlessProducersByGood.get(goodType)?.has(buildingType) ?? false;
}

/** {@link typeProducesGoodWithoutInputs} for a building entity; the caller gates built and reachable. */
export function producesGoodWithoutInputs(
  world: World,
  ctx: SystemContext,
  building: Entity,
  goodType: number,
): boolean {
  const b = world.tryGet(building, Building);
  return b !== undefined && typeProducesGoodWithoutInputs(ctx, b.buildingType, goodType);
}

/** The job types a building type's worker slots name (`logicworker <job> <count>`). */
export function buildingWorkerJobs(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const typeId = knownBuildingTypeId(world, ctx, building);
  if (typeId === undefined) return EMPTY_JOBS;
  return contentIndex(ctx.content).workerJobsByBuilding.get(typeId) ?? EMPTY_JOBS;
}

function knownBuildingTypeId(world: World, ctx: SystemContext, building: Entity): number | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.typeId;
}

const EMPTY_JOBS: ReadonlySet<number> = new Set<number>();

/** The good types a building type's `stock` slots hold; undefined when it declares none. */
export function workplaceStoredGoods(
  world: World,
  ctx: SystemContext,
  building: Entity,
): ReadonlySet<number> | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).storedGoodsByBuilding.get(b.buildingType);
}

/**
 * Whether a workplace whose {@link workplaceStoredGoods} are `stored` counts `goodType` as one of its
 * wares, including a dish banked in its edible form. Type-level on purpose: employment does not wait for
 * `built`, so a gatherer posted to a half-raised warehouse answers for the store it will be.
 */
export function workplaceStocksGood(
  ctx: SystemContext,
  stored: ReadonlySet<number>,
  goodType: number,
): boolean {
  return stored.has(goodType) || stored.has(exportedGoodForm(ctx, goodType));
}

/**
 * Whether a job is the transport trade, the original's carrier (`logicworker 24`), which ferries goods but
 * never operates a craft. Approximation: the readable rule files carry no transport flag, so this keys on
 * the content job's stable `'carrier'` id slug.
 */
export function isCarrierJob(ctx: SystemContext, jobType: number): boolean {
  const job = contentIndex(ctx.content).jobs.get(jobType);
  return job !== undefined && isCarrierJobId(job.id);
}
