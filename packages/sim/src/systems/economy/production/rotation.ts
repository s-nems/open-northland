import type { Recipe } from '@open-northland/data';
import {
  Building,
  ownerOf,
  PRODUCTION_UNLIMITED,
  ProductionCounters,
  productionCountOf,
  writeProductionCount,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, recipeOutputsEnabled, settlerMeetsNeed } from '../../progression/index.js';
import { beginCycle, canStartCycle, isYardBuilt, waitingForRecipeInput } from './cycles.js';

/**
 * The products of `recipes` this operator may craft, in rotation order: every product whose
 * {@link ProductionCounters} counter is at least one, in recipe order, narrowed to what the operator has
 * earned. Observed: a `needforgood` XP threshold locks a ware until the operator's repeats clear it. When
 * every live product is still locked, the pool degrades to every earned product, stopped ones included,
 * rather than stalling a staffed workshop; with every counter at `0` it is empty and the operator starts
 * nothing.
 */
export function craftablePool(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): readonly number[] {
  const subject = needSubjectOf(world, operator);
  const earned = (good: number): boolean => settlerMeetsNeed(world, ctx, subject, 'good', good);
  const selection = world.tryGet(operator, ProductionCounters);
  const pool: number[] = [];
  let lockedLive = false;
  for (const good of recipes.keys()) {
    if (productionCountOf(selection, good) <= 0) continue;
    if (earned(good)) pool.push(good);
    else lockedLive = true;
  }
  return pool.length > 0 || !lockedLive ? pool : [...recipes.keys()].filter(earned);
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
  const cursor = world.tryGet(operator, ProductionCounters)?.cursor ?? 0;
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

/** Move the rotation past `pick` without a start, so a skipped turn resumes after the product. A
 *  first-ever advance stamps an empty selection so the rotation position persists. */
export function advanceRotation(world: World, operator: Entity, pick: RotationPick): void {
  if (!world.has(operator, ProductionCounters))
    world.add(operator, ProductionCounters, { counters: [], cursor: 0 });
  world.mut(operator, ProductionCounters).cursor = (pick.index + 1) % pick.pool.length;
}

/**
 * A start of `pick`: spend one unit of its finite counter and move the rotation past it. A product whose
 * counter runs out leaves the pool, and the cursor stays on the product that followed it. A first-ever
 * start stamps an empty selection so the position persists.
 */
export function spendRotationPick(world: World, operator: Entity, pick: RotationPick): void {
  if (!world.has(operator, ProductionCounters))
    world.add(operator, ProductionCounters, { counters: [], cursor: 0 });
  const count = productionCountOf(world.get(operator, ProductionCounters), pick.good);
  const spent = count > 0 && count < PRODUCTION_UNLIMITED;
  if (spent) writeProductionCount(world, operator, pick.good, count - 1);
  const leaves = spent && count === 1;
  const size = leaves ? pick.pool.length - 1 : pick.pool.length;
  const next = leaves ? pick.index : pick.index + 1;
  world.mut(operator, ProductionCounters).cursor = size > 0 ? next % size : 0;
}

/** Start one cycle of `operator`'s next product choice, or nothing when no chosen product can start or
 *  the choice is a yard-built vehicle, whose turn the planner takes and spends. */
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
  spendRotationPick(world, operator, choice);
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
  const selection = world.tryGet(operator, ProductionCounters);
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
        world.add(operator, ProductionCounters, { counters: [], cursor: alternativeIndex });
      else world.mut(operator, ProductionCounters).cursor = alternativeIndex;
      return;
    }
    return;
  }
}
