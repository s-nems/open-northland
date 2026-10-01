import type { Recipe } from '@open-northland/data';
import {
  Building,
  IdleStand,
  JobAssignment,
  ownerOf,
  Person,
  Production,
  ProductionCounters,
  productionCountOf,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { gatherGoodOpen, isGatheredGood, jobGatherGoods, jobGathersGood } from '../economy/gather-goods.js';
import { canStartCycle, outputRoomForCycles, waitingForRecipeInput } from '../economy/production/cycles.js';
import { craftablePool } from '../economy/production/rotation.js';
import { liveHaulFlag } from '../economy/work-flag.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';
import { operatorRecipeEnabled } from '../progression/index.js';
import { carriedGoodForm } from '../settlers/drives/economy/delivery-targets.js';
import { isBoundToStorageSink } from '../settlers/drives/economy/store-policy.js';
import { FetchableStock } from '../settlers/targets/stores/fetchable-stock.js';
import { StoreSinks } from '../settlers/targets/stores/sinks.js';
import {
  isCarrierJob,
  isWorkplaceOperator,
  isWorkplaceOutput,
  mayFetchGoodFrom,
  recipesByProductOf,
  stockCapacity,
} from '../stores/index.js';
import { gatherWorkStatus } from './gather-work-status.js';
import { GoodSources } from './good-sources.js';
import { type StoreReach, storeReach } from './store-reach.js';

export interface MissingWorkInput {
  readonly goodType: number;
  readonly required: number;
  readonly available: number;
  readonly missing: number;
  /** Where the worker's side keeps or brings in the input: a store holding a unit, a workplace turning
   *  it out or a gatherer of it, as {@link inputSources} lists them. */
  readonly source: StoreReach;
  /** Whether some trade gathers the input off the map, so a gatherer rather than a workshop supplies it. */
  readonly gathered: boolean;
}

export interface BlockedWorkOutput {
  readonly goodType: number;
  readonly required: number;
  readonly available: number;
  readonly capacity: number;
  /** Where the worker's side has stores that take the product in the form it is carried. */
  readonly destination: StoreReach;
}

/** Selected-worker diagnostics are derived on demand, never persisted or used by the planner. */
export type WorkStatus =
  | { readonly kind: 'crafting'; readonly goodType: number }
  | {
      readonly kind: 'waitingInput';
      readonly goodType: number;
      readonly missingInputs: readonly MissingWorkInput[];
    }
  | { readonly kind: 'outputFull'; readonly outputs: readonly BlockedWorkOutput[] }
  | { readonly kind: 'nothingSelected' }
  | { readonly kind: 'productsLocked'; readonly goodTypes: readonly number[] }
  | {
      readonly kind: 'noEligibleResource';
      readonly goodTypes: readonly number[];
      readonly scope: 'workArea' | 'map';
    }
  | { readonly kind: 'resourceRouteBlocked'; readonly goodTypes: readonly number[] }
  | {
      readonly kind: 'noOutputDestination';
      readonly goodType: number;
      /** `outOfReach`: stores would take it, but all of them lie outside the worker's signpost area. */
      readonly reason: 'noStorage' | 'outOfReach' | 'unknown';
    }
  | { readonly kind: 'noWorkplace' }
  | { readonly kind: 'unknown'; readonly reason: 'unsupportedWorkplace' | 'productionGate' | 'gatherSearch' }
  | { readonly kind: 'noTool' }
  | { readonly kind: 'noJob' }
  | { readonly kind: 'workplaceUnderConstruction' }
  /** A carrier holding a pickup flag finds nothing to lift around it. */
  | { readonly kind: 'nothingAtFlag' }
  /** A store's carrier left idle by its ladder: nothing in reach for it to take to a store. */
  | { readonly kind: 'nothingToCarry' }
  /** A hunter's prey search finds no free game it sees in its hunting ground. */
  | { readonly kind: 'noGame' }
  /** The only game in a hunter's ground stands across a terrain seam or was given up as unreachable. */
  | { readonly kind: 'gameOutOfReach' };

/** Read current workplace blockers and a bounded resource search for one selected person. */
export function workStatus(world: World, ctx: SystemContext, entity: Entity): WorkStatus | undefined {
  if (!world.isAlive(entity) || !world.has(entity, Person)) return undefined;
  const jobType = world.get(entity, Settler).jobType;
  if (jobType === null || jobType === CIVILIST_JOB) return { kind: 'noJob' };
  const assigned = world.tryGet(entity, JobAssignment)?.workplace;
  const workplace =
    assigned !== undefined && world.isAlive(assigned) && world.has(assigned, Building) ? assigned : undefined;
  if (workplace !== undefined && world.has(workplace, UnderConstruction)) {
    return { kind: 'workplaceUnderConstruction' };
  }
  const gathered = jobGatherGoods(ctx, jobType);
  if (gathered.length > 0) return gatherWorkStatus(world, ctx, entity, workplace, gathered);
  if (liveHaulFlag(world, entity) !== undefined) return { kind: 'nothingAtFlag' };
  // A store's carrier reaches the idle tail of its ladder only after the porter and haul rungs found
  // nothing in reach a store would take.
  if (
    isCarrierJob(ctx, jobType) &&
    isBoundToStorageSink(world, ctx, entity) &&
    world.tryGet(entity, IdleStand)?.standing === true
  )
    return { kind: 'nothingToCarry' };
  if (workplace === undefined) {
    const index = contentIndex(ctx.content);
    const requiresWorkshop = [...index.operatorJobsByBuilding].some(
      ([type, jobs]) => jobs.has(jobType) && (index.recipeByProductByBuilding.get(type)?.size ?? 0) > 0,
    );
    return requiresWorkshop ? { kind: 'noWorkplace' } : { kind: 'unknown', reason: 'unsupportedWorkplace' };
  }
  if (!world.has(workplace, Stockpile) || !isWorkplaceOperator(world, ctx, workplace, jobType))
    return { kind: 'unknown', reason: 'unsupportedWorkplace' };
  const recipes = recipesByProductOf(world, ctx, workplace);
  if (recipes === undefined) return { kind: 'unknown', reason: 'unsupportedWorkplace' };

  const newest = world.tryGet(workplace, Production)?.cycles.at(-1);
  if (newest !== undefined) return { kind: 'crafting', goodType: newest.goodType };

  const pool = craftablePool(world, ctx, entity, recipes);
  if (pool.length === 0) {
    const selection = world.tryGet(entity, ProductionCounters);
    const allStopped = [...recipes.keys()].every((good) => productionCountOf(selection, good) === 0);
    return allStopped
      ? { kind: 'nothingSelected' }
      : {
          kind: 'productsLocked',
          goodTypes: [...recipes.keys()].filter((good) => productionCountOf(selection, good) > 0),
        };
  }
  const inRotation = rotationOrder(world, entity, pool, recipes);
  let held: PoolEntry | undefined;
  for (const entry of inRotation) {
    if (!operatorRecipeEnabled(world, ctx, workplace, entity, entry.recipe)) continue;
    if (canStartCycle(world, ctx, workplace, entry.recipe)) return undefined;
    if (waitingForRecipeInput(world, ctx, workplace, entry.recipe)) {
      held = entry;
      break;
    }
  }
  // The rotation holds its turn on a partly stocked product, so that one is next; otherwise the first
  // product with shelf room is the one waiting for its inputs.
  const waiting =
    held ?? inRotation.find((entry) => hasShelfRoom(world, ctx, workplace, entity, entry.recipe));
  if (waiting !== undefined) {
    const stock = world.get(workplace, Stockpile).amounts;
    const missingInputs = waiting.recipe.inputs.flatMap((input) => {
      const available = stock.get(input.goodType) ?? 0;
      return available < input.amount
        ? [
            {
              goodType: input.goodType,
              required: input.amount,
              available,
              missing: input.amount - available,
              source: storeReach(
                world,
                ctx,
                entity,
                inputSources(world, ctx, entity, workplace, input.goodType),
              ),
              gathered: isGatheredGood(ctx, input.goodType),
            },
          ]
        : [];
    });
    return missingInputs.length > 0
      ? { kind: 'waitingInput', goodType: waiting.good, missingInputs }
      : { kind: 'unknown', reason: 'productionGate' };
  }
  const enabled = inRotation.filter((entry) =>
    operatorRecipeEnabled(world, ctx, workplace, entity, entry.recipe),
  );
  if (enabled.length === 0) return { kind: 'productsLocked', goodTypes: pool.slice() };
  const stock = world.get(workplace, Stockpile).amounts;
  const sinks = StoreSinks.of(world, ctx);
  const outputs = enabled
    .flatMap((entry) =>
      entry.recipe.outputs.map((output) => ({
        goodType: output.goodType,
        required: output.amount,
        available: stock.get(output.goodType) ?? 0,
        capacity: stockCapacity(world, ctx, workplace, output.goodType),
      })),
    )
    .filter((output) => output.capacity - output.available < output.required)
    .map((output) => ({
      ...output,
      destination: storeReach(
        world,
        ctx,
        entity,
        sinks.sinks(carriedGoodForm(world, ctx, entity, output.goodType), false),
      ),
    }));
  if (outputs.length === 0) return { kind: 'unknown', reason: 'productionGate' };
  const stranded = outputs.find((output) => output.destination === 'outOfReach');
  return stranded !== undefined
    ? { kind: 'noOutputDestination', goodType: stranded.goodType, reason: 'outOfReach' }
    : { kind: 'outputFull', outputs };
}

/**
 * Where an operator may get `goodType` for `workplace`: the stores lending a unit, as its fetch searches
 * them, then its side's sources of the good ({@link GoodSources}). A producer's next unit lands on its own
 * shelf, where the fetch finds it, so an empty farm next door still supplies the mill.
 */
function* inputSources(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  workplace: Entity,
  goodType: number,
): Generator<Entity> {
  yield* FetchableStock.of(world, ctx).holders(goodType);
  for (const source of GoodSources.of(world, ctx).sources(goodType, ownerOf(world, operator))) {
    const found = world.has(source, Settler)
      ? landingOf(world, ctx, source, workplace, goodType)
      : finishedWorkplace(world, source);
    if (found !== undefined) yield found;
  }
}

/**
 * Where `settler`'s work lands `goodType` for `workplace`, or undefined when it brings none there: a
 * gatherer of the good banks at its own finished workplace when that is `workplace` or lends the good,
 * and otherwise at a store, so it stands for itself; an operator's unit lands on its finished
 * workplace's shelf when that type turns the good out. A gatherer at another workshop whose recipe
 * consumes the good keeps it, and a settler held off the good by its counters gathers none.
 */
function landingOf(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  workplace: Entity,
  goodType: number,
): Entity | undefined {
  const jobType = world.get(settler, Settler).jobType;
  if (jobType === null) return undefined;
  const own = world.tryGet(settler, JobAssignment)?.workplace;
  const finished = own === undefined ? undefined : finishedWorkplace(world, own);
  if (jobGathersGood(ctx, jobType, goodType)) {
    if (!gatherGoodOpen(world, ctx, settler, jobType, goodType)) return undefined;
    if (finished === undefined) return settler;
    return finished === workplace || mayFetchGoodFrom(world, ctx, finished, goodType) ? finished : undefined;
  }
  return finished !== undefined &&
    isWorkplaceOperator(world, ctx, finished, jobType) &&
    isWorkplaceOutput(world, ctx, finished, goodType)
    ? finished
    : undefined;
}

function finishedWorkplace(world: World, e: Entity): Entity | undefined {
  return world.isAlive(e) && world.has(e, Building) && !world.has(e, UnderConstruction) ? e : undefined;
}

interface PoolEntry {
  readonly good: number;
  readonly recipe: Recipe;
}

/** The operator's pool in the order its rotation walks it, starting at the cursor. */
function rotationOrder(
  world: World,
  operator: Entity,
  pool: readonly number[],
  recipes: ReadonlyMap<number, Recipe>,
): PoolEntry[] {
  const cursor = world.tryGet(operator, ProductionCounters)?.cursor ?? 0;
  const ordered: PoolEntry[] = [];
  for (let i = 0; i < pool.length; i++) {
    const good = pool[(cursor + i) % pool.length];
    const recipe = good === undefined ? undefined : recipes.get(good);
    if (good !== undefined && recipe !== undefined) ordered.push({ good, recipe });
  }
  return ordered;
}

function hasShelfRoom(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  worker: Entity,
  recipe: Recipe,
): boolean {
  return (
    operatorRecipeEnabled(world, ctx, workplace, worker, recipe) &&
    outputRoomForCycles(world, ctx, workplace, recipe) > 0
  );
}
