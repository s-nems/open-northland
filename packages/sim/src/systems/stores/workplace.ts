import type { Recipe } from '@open-northland/data';
import { Building } from '../../components/index.js';
import { isCarrierJobId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

// What a building's TYPE declares: what it makes, the job slots it offers, the goods it stores. The
// operator concept (which of those slots run the craft, and who fills them) is ./operators.ts.

/**
 * The UNION view over a building type's per-product recipes (inputs summed, outputs one line per
 * product — {@link import('../../core/content-index.js').ContentIndex.mergedRecipeByBuilding}), or
 * undefined if it has no Building/type or no recipes.
 *
 * Cross-system: the AI plans against it (recognise a workplace, stock any input some product needs, haul
 * any product out); the ProductionSystem runs the per-product recipes ({@link recipesByProductOf}). An
 * OPERATOR fetches against its own rotation's narrower view instead (`operatorRecipes`); the bound carrier
 * keeps this one, since it supplies every operator.
 */
export function mergedRecipeOf(world: World, ctx: SystemContext, building: Entity): Recipe | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).mergedRecipeByBuilding.get(b.buildingType);
}

/**
 * A building's per-product recipe table (`product goodType → recipe`), or undefined when it has no
 * Building/type or no recipes. The ProductionSystem's cycle-start/deposit lookup; iteration follows
 * the type's `recipes` content order (fixed data, deterministic).
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
 * The goods a building's type produces (`logicproduction` — its `produces` list), or empty when it has no
 * Building/type or produces nothing (a passive store: a warehouse/HQ). The data-driven "is this a producing
 * building" signal — the split behind "a carrier at production hauls the output out, a carrier at a warehouse
 * only brings goods in". A recipe workshop's `produces` mirrors its recipe outputs, so this covers both
 * producer kinds; a warehouse's is empty. It does not distinguish a farm by recipe absence: the sandbox
 * catalog's farm carries no recipe, but the asset pipeline synthesizes a recipe for every producing building
 * (`fillBuildingRecipes`), so "field producer" must be keyed on the good's `farming` block (`farmWorkGood`),
 * never on `mergedRecipeOf`.
 *
 * Cross-system: the AI carrier drive uses it to recognise a bound producing building whose finished output it
 * should haul to a warehouse (see `settlers/drives/economy/workshop/supply.ts`).
 */
export function buildingProduces(world: World, ctx: SystemContext, building: Entity): readonly number[] {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_PRODUCES;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.produces ?? EMPTY_PRODUCES;
}

const EMPTY_PRODUCES: readonly number[] = [];

/**
 * Whether building type `buildingType` is an UNSTAFFED shared utility that mints `goodType` from no inputs —
 * a well for water, a hive for honey — that a consumer can crank in place to draw the good. Data-driven via
 * {@link import('../../core/content-index.js').ContentIndex.inputlessProducersByGood} (an unstaffed
 * input-less producer of the good, never a hardcoded id); a staffed input-less producer does not qualify.
 *
 * Cross-system: the self-service input scan
 * ({@link import('../settlers/drives/economy/workshop/supply.js').nearestMissingInputSource}) lets a
 * consumer draw the good here when this utility is the nearest source, and the utility-carrier delivery
 * rung (`toNearbyRecipeConsumer`) uses it to feed the good to nearby consumers before central storage.
 */
export function typeProducesGoodWithoutInputs(
  ctx: SystemContext,
  buildingType: number,
  goodType: number,
): boolean {
  return contentIndex(ctx.content).inputlessProducersByGood.get(goodType)?.has(buildingType) ?? false;
}

/** {@link typeProducesGoodWithoutInputs} for a building entity — resolves its type first (false if it has
 *  no Building/type). The caller gates built/reachable. */
export function producesGoodWithoutInputs(
  world: World,
  ctx: SystemContext,
  building: Entity,
  goodType: number,
): boolean {
  const b = world.tryGet(building, Building);
  return b !== undefined && typeProducesGoodWithoutInputs(ctx, b.buildingType, goodType);
}

/**
 * The set of job types a building type's `workers` slots name (`logicworker <job> <count>`). Empty
 * if the building has no Building/type or declares no workers (an unstaffed-by-design building — a
 * passive store, or any type without worker slots).
 */
export function buildingWorkerJobs(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const typeId = knownBuildingTypeId(world, ctx, building);
  if (typeId === undefined) return EMPTY_JOBS;
  return contentIndex(ctx.content).workerJobsByBuilding.get(typeId) ?? EMPTY_JOBS;
}

/** {@link buildingWorkerJobs} as an ascending list — the canonical slot order a workplace offers its
 *  jobs in, so a multi-slot workplace assigns by lowest job id rather than by `Set` insertion order. */
export function canonicalBuildingWorkerJobs(
  world: World,
  ctx: SystemContext,
  building: Entity,
): readonly number[] {
  const typeId = knownBuildingTypeId(world, ctx, building);
  if (typeId === undefined) return EMPTY_JOB_LIST;
  return contentIndex(ctx.content).canonicalWorkerJobsByBuilding.get(typeId) ?? EMPTY_JOB_LIST;
}

function knownBuildingTypeId(world: World, ctx: SystemContext, building: Entity): number | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(b.buildingType)?.typeId;
}

const EMPTY_JOBS: ReadonlySet<number> = new Set<number>();
/** Frozen so a caller that widens the `readonly` type can't mutate the shared sentinel (see `NO_ENTITIES`). */
const EMPTY_JOB_LIST: readonly number[] = Object.freeze([]);

/**
 * The set of good types a building's `stock` slots store, or undefined when it has no Building/type
 * or declares no stock slots. Cross-system: what a building-employed gatherer may forage for (the
 * flag-less collector rule — `planGatherer`'s roaming filter and the `setGatherGood` employed path).
 */
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
 * Whether a job is the transport trade — the original's carrier (`logicworker 24`, the "tragarz" who ferries
 * goods but never operates a workshop's craft). Identified by the content job's `id` slug (`'carrier'`), the
 * same id-based inference {@link isFood} uses (approximated — the readable rule files carry no explicit
 * transport flag; both the sandbox content and the extraction pipeline emit the carrier job under this stable
 * slug).
 */
export function isCarrierJob(ctx: SystemContext, jobType: number): boolean {
  const job = contentIndex(ctx.content).jobs.get(jobType);
  return job !== undefined && isCarrierJobId(job.id);
}
