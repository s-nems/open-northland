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
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { jobGatherGoods } from '../economy/gather-goods.js';
import { canStartCycle, outputRoomForCycles, waitingForRecipeInput } from '../economy/production/cycles.js';
import { craftablePool } from '../economy/production/rotation.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';
import { recipeOutputsEnabled } from '../progression/index.js';
import {
  isWorkplaceOperator,
  recipesByProductOf,
  workplaceStocksGood,
  workplaceStoredGoods,
} from '../stores/index.js';

/**
 * Why a craft worker or gatherer works or stands idle, for the settler panel's status line. A gatherer
 * reports only `nothingSelected`, `noJob` and `workplaceUnderConstruction`.
 *
 * - `crafting`: its workplace has a running cycle of `goodType`. Approximation: cycles are not attributed
 *   to an operator, so this names the workplace's newest cycle.
 * - `waitingInput`: no product can start and `goodType`, the next one the rotation would make, lacks
 *   inputs.
 * - `outputFull`: every product in its rotation that could start has a full shelf.
 * - `nothingSelected`: every production counter is `0`: of the workplace's products, or of the goods a
 *   gatherer would gather.
 * - `noTool`: reserved for a trade that cannot work without a tool. No trade requires one today (a tool
 *   only adds the production credit), so the sim never reports it.
 * - `noJob`: an adult without a trade, or the generic civilian a grown boy becomes.
 * - `workplaceUnderConstruction`: its workplace is still a construction site or being upgraded.
 */
export type WorkStatus =
  | { readonly kind: 'crafting'; readonly goodType: number }
  | { readonly kind: 'waitingInput'; readonly goodType: number }
  | { readonly kind: 'outputFull' }
  | { readonly kind: 'nothingSelected' }
  | { readonly kind: 'noTool' }
  | { readonly kind: 'noJob' }
  | { readonly kind: 'workplaceUnderConstruction' };

/**
 * The {@link WorkStatus} of `entity`, or undefined when none applies: not a person, neither a gatherer nor
 * a craft operator of a recipe workplace, or about to start a cycle. Reads the settler and its workplace
 * only.
 */
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
  if (gathered.length > 0) return gatherStatus(world, ctx, entity, workplace, gathered);
  if (workplace === undefined) return undefined;
  if (!world.has(workplace, Stockpile) || !isWorkplaceOperator(world, ctx, workplace, jobType))
    return undefined;
  const recipes = recipesByProductOf(world, ctx, workplace);
  if (recipes === undefined) return undefined;

  const newest = world.tryGet(workplace, Production)?.cycles.at(-1);
  if (newest !== undefined) return { kind: 'crafting', goodType: newest.goodType };

  const pool = craftablePool(world, ctx, entity, recipes);
  if (pool.length === 0) {
    const selection = world.tryGet(entity, ProductionCounters);
    const allStopped = [...recipes.keys()].every((good) => productionCountOf(selection, good) === 0);
    return allStopped ? { kind: 'nothingSelected' } : undefined;
  }
  const inRotation = rotationOrder(world, entity, pool, recipes);
  if (inRotation.some((entry) => canStartCycle(world, ctx, workplace, entry.recipe))) return undefined;
  // The rotation holds its turn on a partly stocked product, so that one is next; otherwise the first
  // product with shelf room is the one waiting for its inputs.
  const waiting =
    inRotation.find((entry) => waitingForRecipeInput(world, ctx, workplace, entry.recipe)) ??
    inRotation.find((entry) => hasShelfRoom(world, ctx, workplace, entry.recipe));
  if (waiting !== undefined) return { kind: 'waitingInput', goodType: waiting.good };
  return inRotation.some((entry) => recipeEnabled(world, ctx, workplace, entry.recipe))
    ? { kind: 'outputFull' }
    : undefined;
}

/**
 * A gatherer's status: `nothingSelected` when its counters stop every good it would gather - its trade's
 * goods, narrowed for a gatherer posted to a stocking building to the goods that building stocks.
 */
function gatherStatus(
  world: World,
  ctx: SystemContext,
  entity: Entity,
  workplace: Entity | undefined,
  gathered: readonly number[],
): WorkStatus | undefined {
  const counters = world.tryGet(entity, ProductionCounters);
  if (counters === undefined) return undefined;
  const stored = workplace === undefined ? undefined : workplaceStoredGoods(world, ctx, workplace);
  const wanted =
    stored === undefined ? gathered : gathered.filter((good) => workplaceStocksGood(ctx, stored, good));
  const allStopped = wanted.length > 0 && wanted.every((good) => productionCountOf(counters, good) === 0);
  return allStopped ? { kind: 'nothingSelected' } : undefined;
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
