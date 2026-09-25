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
 * The source for the input `workplace` lacks most, or null when every input is stocked and nothing
 * reachable holds a short one: the nearest store that holds the good, a well's or hive's own shelf
 * included. Short inputs rank by how full they are against their target, emptiest first, ties in recipe
 * order; an input no reachable store holds falls through to the next. The trip brings one unit, so a
 * shortfall of two is two trips. Never from another player's store, nor a cell the worker failed to reach.
 *
 * Approximation: the original's pick order between short inputs is unobserved; emptiest-first is authored.
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
  const inputs = recipe.inputs;
  // Each round picks the emptiest short input ranked after the previous round's pick, so a fall-through
  // walks the ranking without building it; the rescan only repeats when a pick has no source.
  let lastIndex = -1;
  let lastHave = 0;
  let lastTarget = 0;
  for (;;) {
    let pick = -1;
    let pickHave = 0;
    let pickTarget = 0;
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      if (input === undefined) continue;
      const have = (stock.get(input.goodType) ?? 0) + (shortfall.inbound?.(input.goodType) ?? 0);
      const target = shortfall.restockToCapacity
        ? stockCapacity(world, ctx, workplace, input.goodType)
        : input.amount;
      if (have >= target) continue;
      if (lastIndex >= 0 && !ranksBefore(lastHave, lastTarget, lastIndex, have, target, i)) continue;
      if (pick < 0 || ranksBefore(have, target, i, pickHave, pickTarget, pick)) {
        pick = i;
        pickHave = have;
        pickTarget = target;
      }
    }
    const input = inputs[pick];
    if (input === undefined) return null;
    const winner = targets.bands.inputSources(input.goodType).nearest(
      here,
      // The workplace never supplies itself.
      (e) => (e === workplace ? null : QUALIFIES),
      plan.limit ?? undefined,
      avoid,
      sameSideAs(world, plan.owner),
    );
    if (winner !== null) return { store: winner.entity, goodType: input.goodType };
    lastIndex = pick;
    lastHave = pickHave;
    lastTarget = pickTarget;
  }
}

/** Whether short input `a` fills less of its target than `b` (`have / target` compared by
 *  cross-multiplication, so the rank stays in integers), the earlier recipe index breaking a tie. */
function ranksBefore(
  haveA: number,
  targetA: number,
  indexA: number,
  haveB: number,
  targetB: number,
  indexB: number,
): boolean {
  const a = haveA * targetB;
  const b = haveB * targetA;
  return a !== b ? a < b : indexA < indexB;
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
