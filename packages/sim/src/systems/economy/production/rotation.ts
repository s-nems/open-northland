import type { Recipe } from '@open-northland/data';
import { Building, CraftSelection, ownerOf } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, recipeOutputsEnabled, settlerMeetsNeed } from '../../progression/index.js';
import { beginCycle, canStartCycle, isYardBuilt, waitingForRecipeInput } from './cycles.js';

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

/** The product an operator's rotation takes next: `good` at `index` into its craftable `pool`. */
export interface RotationPick {
  readonly good: number;
  readonly index: number;
  readonly pool: readonly number[];
}

/**
 * The next product of `operator`'s rotation at `building`, or null when no chosen product can start: the
 * walk takes the first product from the rotation cursor that is either startable or yard-built. A
 * yard-built product is the planner's turn (`drives/economy/vehicle-yard`) rather than a cycle here, so it
 * stops the walk like a start would. A product with a full shelf is skipped, while one waiting for inputs
 * holds its turn so a cheaper recipe cannot consume each incoming unit.
 */
export function nextRotationPick(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): RotationPick | null {
  const pool = craftablePool(world, ctx, operator, recipes);
  if (pool.length === 0) return null; // no recipes at all, or none this operator has earned yet
  const cursor = world.tryGet(operator, CraftSelection)?.cursor ?? 0;
  for (let i = 0; i < pool.length; i++) {
    const index = (cursor + i) % pool.length;
    const good = pool[index];
    const recipe = good !== undefined ? recipes.get(good) : undefined;
    if (good === undefined || recipe === undefined) continue;
    if (yardTurnOpen(world, ctx, building, recipe) || canStartCycle(world, ctx, building, recipe)) {
      return { good, index, pool };
    }
    if (waitingForRecipeInput(world, ctx, building, recipe)) return null;
  }
  return null;
}

/** A yard-built product the player's tribe may make: the yard turn's own start gate, since a vehicle is
 *  never a cycle and `canStartCycle` refuses it outright. */
function yardTurnOpen(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): boolean {
  if (!isYardBuilt(ctx, recipe)) return false;
  const b = world.get(building, Building);
  return recipeOutputsEnabled(world, ctx, ownerOf(world, building), b.tribe, recipe);
}

/** Move the rotation past `pick`, so alternation resumes after the product just taken. A first-ever
 *  advance stamps an empty selection so the rotation position persists. */
export function advanceRotation(world: World, operator: Entity, pick: RotationPick): void {
  if (!world.has(operator, CraftSelection)) world.add(operator, CraftSelection, { goods: [], cursor: 0 });
  world.mut(operator, CraftSelection).cursor = (pick.index + 1) % pick.pool.length;
}

/** Start one cycle of `operator`'s next product choice, or nothing when no chosen product can start or
 *  the choice is a yard-built vehicle, whose turn the planner takes and advances. */
export function startCycleFor(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): void {
  const choice = nextCycleFor(world, ctx, building, operator, recipes);
  if (choice === undefined) return;
  beginCycle(world, building, choice.recipe, choice.good);
  advanceRotation(world, operator, choice);
}

/** {@link nextRotationPick} as a cycle to begin, or undefined when the pick is a yard-built vehicle. */
export function nextCycleFor(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): (RotationPick & { readonly recipe: Recipe }) | undefined {
  const pick = nextRotationPick(world, ctx, building, operator, recipes);
  const recipe = pick === null ? undefined : recipes.get(pick.good);
  if (pick === null || recipe === undefined || isYardBuilt(ctx, recipe)) return undefined;
  return { ...pick, recipe };
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
