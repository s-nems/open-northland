import type { Recipe } from '@open-northland/data';
import { Building, Production, Stockpile, sameSideAs } from '../../../../../components/index.js';
import { ONE } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { craftablePool, startableCycleCount } from '../../../../economy/production.js';
import {
  buildingProduces,
  isWorkplaceOutput,
  mergedRecipeOf,
  recipesByProductOf,
  stockCapacity,
} from '../../../../stores/index.js';
import type { PlannerContext } from '../../../planner/context.js';
import { QUALIFIES } from '../../../targets/index.js';
import { unreachableGoalVeto } from '../../../unreachable-goals.js';

// The producer supply scans: a worker fetches the recipe inputs its workplace is short on and hauls the
// finished output out, so the loop closes without a dedicated carrier. Every choice is recipe-driven and
// canonically scanned, so the winner never depends on store history.

/**
 * The recipes an operator's rotation would actually pick at `workplace`: its craftable products resolved
 * back to their per-product recipes, empty when it has earned none of them.
 */
export function operatorRecipes(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  operator: Entity,
): readonly Recipe[] {
  const recipes = recipesByProductOf(world, ctx, workplace);
  if (recipes === undefined) return [];
  const own: Recipe[] = [];
  for (const good of craftablePool(world, ctx, operator, recipes)) {
    const recipe = recipes.get(good);
    if (recipe !== undefined) own.push(recipe);
  }
  return own;
}

/**
 * How many work seats the workplace offers this tick: the cycles already grinding, each of which needs one
 * present operator to advance, plus the further cycles this operator's own recipes could start. The planner
 * hands out seats in canonical settler order, so a worker that finds them all taken is surplus and is freed
 * to fetch inputs or haul output instead of idling inside while a colleague's batch finishes.
 *
 * Approximation: the further-seat estimate is the max over the operator's pool, so two spare operators
 * whose pools name different startable products fill two seats where this counts one.
 */
export function workSeatCount(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  own: readonly Recipe[],
): number {
  const running = world.tryGet(workplace, Production)?.cycles.length ?? 0;
  const b = world.tryGet(workplace, Building);
  if (b === undefined || b.built < ONE) return running; // a construction site never starts a cycle
  let startable = 0;
  for (const recipe of own) {
    startable = Math.max(startable, startableCycleCount(world, ctx, workplace, recipe));
  }
  return running + startable;
}

/** The store a producer worker fetches one unit of a missing recipe input from. */
export interface MissingInputSource {
  readonly store: Entity;
  readonly goodType: number;
}

/**
 * How far a fetch tops an input up. `restockToCapacity` raises the target from the recipe amount to the
 * workplace's declared input-slot capacity, the bound carrier's shape (observed original behaviour).
 * `inbound`, when given, counts the units other settlers are bringing as already stocked.
 */
export interface InputShortfall {
  readonly restockToCapacity: boolean;
  readonly inbound?: (goodType: number) => number;
}

/**
 * The source for the first input `workplace` is short of, or null when every input is stocked and
 * nothing reachable holds one: the nearest store that holds the good, a well's or hive's own shelf
 * included. The trip brings one unit, so a shortfall of two is two trips. Never from another player's
 * store, nor a cell the worker failed to reach. Source basis: authored.
 */
export function nearestMissingInputSource(
  plan: PlannerContext,
  workplace: Entity,
  recipe: Recipe,
  shortfall: InputShortfall,
): MissingInputSource | null {
  const { world, ctx, here, targets } = plan;
  const stock = world.get(workplace, Stockpile).amounts;
  const avoid = unreachableGoalVeto(world, ctx, plan.entity);
  for (const input of recipe.inputs) {
    const have = (stock.get(input.goodType) ?? 0) + (shortfall.inbound?.(input.goodType) ?? 0);
    const target = shortfall.restockToCapacity
      ? stockCapacity(world, ctx, workplace, input.goodType)
      : input.amount;
    if (have >= target) continue;
    const winner = targets.bands.inputSources(input.goodType).nearest(
      here,
      // The workplace never supplies itself.
      (e) => (e === workplace ? null : QUALIFIES),
      plan.limit ?? undefined,
      avoid,
      sameSideAs(world, plan.owner),
    );
    if (winner !== null) return { store: winner.entity, goodType: input.goodType };
  }
  return null;
}

/**
 * The finished output a producer should haul out of its own workplace to clear room for the next cycle, or
 * null when it holds none another store can accept. Walked in the type's `produces` order, so the pick
 * never depends on store insertion history.
 */
export function workplaceOutputToHaul(
  deliverable: (goodType: number) => boolean,
  world: World,
  ctx: SystemContext,
  workplace: Entity,
): number | null {
  const stock = world.get(workplace, Stockpile).amounts;
  const produces = buildingProduces(world, ctx, workplace);
  const made = mergedRecipeOf(world, ctx, workplace)?.outputs.map((o) => o.goodType) ?? [];
  for (const good of produces.length > 0 ? produces : made) {
    if ((stock.get(good) ?? 0) <= 0 || !isWorkplaceOutput(world, ctx, workplace, good)) continue;
    // The routing itself excludes this producer as a sink.
    if (deliverable(good)) return good;
  }
  return null;
}
