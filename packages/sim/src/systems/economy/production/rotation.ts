import type { Recipe } from '@open-northland/data';
import { CraftSelection } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { beginCycle, canStartCycle, waitingForRecipeInput } from './cycles.js';

/**
 * The products of `recipes` this operator may craft, in rotation order: its {@link CraftSelection} goods,
 * else every product of the workplace, each narrowed to what the operator has earned. Observed: a
 * `needforgood` XP threshold locks a ware until the operator's repeats clear it. A selection naming nothing
 * this workplace makes, or nothing earned, degrades to the all-products default rather than stalling a
 * staffed workshop.
 */
export function craftablePool(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): readonly number[] {
  const subject = needSubjectOf(world, operator);
  const earned = (good: number): boolean => settlerMeetsNeed(world, ctx, subject, 'good', good);
  const picked =
    world.tryGet(operator, CraftSelection)?.goods.filter((g) => recipes.has(g) && earned(g)) ?? [];
  return picked.length > 0 ? picked : [...recipes.keys()].filter(earned);
}

/**
 * Start one cycle of `operator`'s next product choice, or nothing when no chosen product can start. The walk
 * takes the first startable product from the rotation cursor and advances the cursor past it. A product
 * with a full shelf is skipped, while one waiting for inputs holds its turn so a cheaper recipe cannot
 * consume each incoming unit. A first-ever start stamps an empty selection so the position persists.
 */
export function startCycleFor(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): void {
  const pool = craftablePool(world, ctx, operator, recipes);
  if (pool.length === 0) return; // no recipes at all, or none this operator has earned yet
  const selection = world.tryGet(operator, CraftSelection);
  const cursor = selection?.cursor ?? 0;
  for (let i = 0; i < pool.length; i++) {
    const good = pool[(cursor + i) % pool.length];
    const recipe = good !== undefined ? recipes.get(good) : undefined;
    if (good === undefined || recipe === undefined) continue;
    if (!canStartCycle(world, ctx, building, recipe)) {
      if (waitingForRecipeInput(world, ctx, building, recipe)) return;
      continue;
    }
    beginCycle(world, building, recipe, good);
    if (selection === undefined) world.add(operator, CraftSelection, { goods: [], cursor: 0 });
    world.mut(operator, CraftSelection).cursor = (cursor + i + 1) % pool.length;
    return;
  }
}

/** Let a startable product take the turn when the planner found no source for the next recipe's input. */
export function skipUnfundedRecipe(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  own: readonly Recipe[],
): void {
  if (own.length < 2) return;
  const selection = world.tryGet(operator, CraftSelection);
  const cursor = (selection?.cursor ?? 0) % own.length;
  for (let i = 0; i < own.length; i++) {
    const index = (cursor + i) % own.length;
    const recipe = own[index];
    if (recipe === undefined || canStartCycle(world, ctx, building, recipe)) return;
    if (!waitingForRecipeInput(world, ctx, building, recipe)) continue;
    for (let j = i + 1; j < own.length; j++) {
      const alternativeIndex = (cursor + j) % own.length;
      const alternative = own[alternativeIndex];
      if (alternative === undefined || !canStartCycle(world, ctx, building, alternative)) continue;
      if (selection === undefined)
        world.add(operator, CraftSelection, { goods: [], cursor: alternativeIndex });
      else world.mut(operator, CraftSelection).cursor = alternativeIndex;
      return;
    }
    return;
  }
}
