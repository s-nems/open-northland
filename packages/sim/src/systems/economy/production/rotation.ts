import type { Recipe } from '@open-northland/data';
import {
  PRODUCTION_UNLIMITED,
  ProductionCounters,
  productionCountOf,
  Settler,
  writeProductionCount,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { religionAllowsAtomic } from '../../lifecycle/needs/religion.js';
import {
  emptyNeedSubject,
  needSubjectInto,
  operatorRecipeEnabled,
  settlerMeetsNeed,
} from '../../progression/index.js';
import { resolvedAtomicLength } from '../../readviews/animations.js';
import { productionAtomic } from '../../readviews/production-atomic.js';
import { beginCycle, canStartCycle, cycleCoveredWith, isYardBuilt, waitingForRecipeInput } from './cycles.js';

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
  const pool: number[] = [];
  craftablePoolInto(world, ctx, operator, recipes, pool);
  return pool;
}

/**
 * {@link craftablePool} written over the head of `out`, returning its size; the entries past it are
 * stale. A per-tick caller reuses one list this way, since an emptied array drops its storage.
 */
export function craftablePoolInto(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
  out: number[],
): number {
  const subject = needSubjectInto(world, operator, subjectScratch);
  const selection = world.tryGet(operator, ProductionCounters);
  const goods = productsOfRecipes(recipes);
  let size = 0;
  let lockedLive = false;
  for (let i = 0; i < goods.length; i++) {
    const good = goods[i] as number;
    if (productionCountOf(selection, good) <= 0) continue;
    if (settlerMeetsNeed(world, ctx, subject, 'good', good)) out[size++] = good;
    else lockedLive = true;
  }
  if (size > 0 || !lockedLive) return size;
  for (let i = 0; i < goods.length; i++) {
    const good = goods[i] as number;
    if (settlerMeetsNeed(world, ctx, subject, 'good', good)) out[size++] = good;
  }
  return size;
}

/** The products of `recipes` in recipe order, listed once per content recipe map, which never changes
 *  after load: walking the map's key iterator would allocate a step result per product per operator per
 *  tick. */
function productsOfRecipes(recipes: ReadonlyMap<number, Recipe>): readonly number[] {
  const held = productsByRecipes.get(recipes);
  if (held !== undefined) return held;
  const goods = [...recipes.keys()];
  productsByRecipes.set(recipes, goods);
  return goods;
}

const productsByRecipes = new WeakMap<ReadonlyMap<number, Recipe>, readonly number[]>();

/** The operator {@link craftablePoolInto} is asking for, read by its gates and by nothing after it. */
const subjectScratch = emptyNeedSubject();

/** The product an operator's rotation takes next: `good` at `index` into its craftable `pool`. */
export interface RotationPick {
  readonly good: number;
  readonly index: number;
  readonly pool: readonly number[];
}

/** A {@link RotationPick} with the product's recipe. */
export type CycleChoice = RotationPick & { readonly recipe: Recipe };

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
): CycleChoice | null {
  const pool = poolScratch;
  const size = craftablePoolInto(world, ctx, operator, recipes, pool);
  if (size === 0) return null; // no recipes at all, or none this operator has earned yet
  const cursor = world.tryGet(operator, ProductionCounters)?.cursor ?? 0;
  for (let i = 0; i < size; i++) {
    const index = (cursor + i) % size;
    const good = pool[index];
    const recipe = good !== undefined ? recipes.get(good) : undefined;
    if (good === undefined || recipe === undefined) continue;
    if (
      !religionAllowsAtomic(
        world,
        ctx,
        operator,
        productionAtomic(ctx.content, world.get(operator, Settler), good),
      )
    )
      continue;
    if (!operatorRecipeEnabled(world, ctx, building, operator, recipe)) continue;
    if (isYardBuilt(ctx, recipe) || canStartCycle(world, ctx, building, recipe)) {
      return { good, index, pool: pool.slice(0, size), recipe };
    }
    if (waitingForRecipeInput(world, ctx, building, recipe)) return null;
  }
  return null;
}

/** The pool {@link nextRotationPick} walks, copied only into the pick it returns. */
const poolScratch: number[] = [];

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

/** Start the cycle `operator`'s rotation chose and move the rotation past it. */
export function startCycleChoice(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  choice: CycleChoice,
): void {
  const duration = craftCycleTicks(world, ctx, operator, choice.good, choice.recipe);
  beginCycle(world, building, choice.recipe, choice.good, duration);
  spendRotationPick(world, operator, choice);
}

/**
 * Ticks of one batch of `good` that `operator` crafts. Original behavior: the batch is one playthrough of
 * the good's produce clip as the operator's tribe and trade bind it, back to back, never shortened by
 * skill. `recipe.ticks` stands in when the good has no produce atomic or the clip does not resolve.
 */
function craftCycleTicks(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  good: number,
  recipe: Recipe,
): number {
  const settler = world.tryGet(operator, Settler);
  if (settler === undefined) return recipe.ticks;
  const produce = productionAtomic(ctx.content, settler, good);
  if (produce === undefined) return recipe.ticks;
  return resolvedAtomicLength(ctx.content, settler, produce) ?? recipe.ticks;
}

/** {@link nextRotationPick} as a cycle to begin, or undefined when the pick is a yard-built vehicle. */
export function nextCycleFor(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): CycleChoice | undefined {
  const pick = nextRotationPick(world, ctx, building, operator, recipes);
  if (pick === null || isYardBuilt(ctx, pick.recipe)) return undefined;
  return pick;
}

/** Let a startable product take the turn when the planner found no source for the next recipe's input.
 *  A recipe whose missing units `inbound` says are on their way keeps the turn. */
export function skipUnfundedRecipe(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  own: readonly Recipe[],
  inbound?: (goodType: number) => number,
): void {
  if (own.length < 2) return;
  const selection = world.tryGet(operator, ProductionCounters);
  const cursor = (selection?.cursor ?? 0) % own.length;
  for (let i = 0; i < own.length; i++) {
    const index = (cursor + i) % own.length;
    const recipe = own[index];
    if (recipe === undefined || canStartCycle(world, ctx, building, recipe)) return;
    if (!waitingForRecipeInput(world, ctx, building, recipe)) continue;
    if (inbound !== undefined && cycleCoveredWith(world, building, recipe, inbound)) return;
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
