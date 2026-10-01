import type { Recipe } from '@open-northland/data';
import {
  Building,
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
import { jobGatherGoods } from '../economy/gather-goods.js';
import { canStartCycle, outputRoomForCycles, waitingForRecipeInput } from '../economy/production/cycles.js';
import { craftablePool } from '../economy/production/rotation.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';
import { recipeOutputsEnabled } from '../progression/index.js';
import { FetchableStock } from '../settlers/targets/stores/fetchable-stock.js';
import { StoreSinks } from '../settlers/targets/stores/sinks.js';
import { isWorkplaceOperator, recipesByProductOf, stockCapacity } from '../stores/index.js';
import { gatherWorkStatus } from './gather-work-status.js';
import { storesOnlyOutOfReach } from './store-reach.js';

export interface MissingWorkInput {
  readonly goodType: number;
  readonly required: number;
  readonly available: number;
  readonly missing: number;
  /** Stores hold the input, but all of them outside the worker's signpost area. */
  readonly outOfReach: boolean;
}

export interface BlockedWorkOutput {
  readonly goodType: number;
  readonly required: number;
  readonly available: number;
  readonly capacity: number;
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
  | { readonly kind: 'workplaceUnderConstruction' };

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
    if (canStartCycle(world, ctx, workplace, entry.recipe)) return undefined;
    if (waitingForRecipeInput(world, ctx, workplace, entry.recipe)) {
      held = entry;
      break;
    }
  }
  // The rotation holds its turn on a partly stocked product, so that one is next; otherwise the first
  // product with shelf room is the one waiting for its inputs.
  const waiting = held ?? inRotation.find((entry) => hasShelfRoom(world, ctx, workplace, entry.recipe));
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
              outOfReach: storesOnlyOutOfReach(
                world,
                ctx,
                entity,
                FetchableStock.of(world, ctx).holders(input.goodType),
              ),
            },
          ]
        : [];
    });
    return missingInputs.length > 0
      ? { kind: 'waitingInput', goodType: waiting.good, missingInputs }
      : { kind: 'unknown', reason: 'productionGate' };
  }
  const enabled = inRotation.filter((entry) => recipeEnabled(world, ctx, workplace, entry.recipe));
  if (enabled.length === 0) return { kind: 'productsLocked', goodTypes: pool.slice() };
  const stock = world.get(workplace, Stockpile).amounts;
  const outputs = enabled
    .flatMap((entry) =>
      entry.recipe.outputs.map((output) => ({
        goodType: output.goodType,
        required: output.amount,
        available: stock.get(output.goodType) ?? 0,
        capacity: stockCapacity(world, ctx, workplace, output.goodType),
      })),
    )
    .filter((output) => output.capacity - output.available < output.required);
  if (outputs.length === 0) return { kind: 'unknown', reason: 'productionGate' };
  const sinks = StoreSinks.of(world, ctx);
  const stranded = outputs.find((output) =>
    storesOnlyOutOfReach(world, ctx, entity, sinks.sinks(output.goodType, false)),
  );
  return stranded !== undefined
    ? { kind: 'noOutputDestination', goodType: stranded.goodType, reason: 'outOfReach' }
    : { kind: 'outputFull', outputs };
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

function recipeEnabled(world: World, ctx: SystemContext, workplace: Entity, recipe: Recipe): boolean {
  return recipeOutputsEnabled(
    world,
    ctx,
    ownerOf(world, workplace),
    world.get(workplace, Building).tribe,
    recipe,
  );
}

function hasShelfRoom(world: World, ctx: SystemContext, workplace: Entity, recipe: Recipe): boolean {
  return (
    recipeEnabled(world, ctx, workplace, recipe) && outputRoomForCycles(world, ctx, workplace, recipe) > 0
  );
}
