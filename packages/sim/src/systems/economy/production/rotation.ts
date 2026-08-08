import type { Recipe } from '@open-northland/data';
import { CraftSelection } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { livestockTribeOfGood } from '../../readviews/index.js';
import { beginCycle, canStartCycle } from './cycles.js';

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
  return picked.length > 0 ? withFeedStages(ctx, picked, recipes) : [...recipes.keys()].filter(earned);
}

/** A selected chain product implies its feed stage: crafting wool consumes the fed-sheep token, so the
 *  token's own recipe joins the pool rather than silently starving the selected product. Deliberately
 *  skips the `earned` gate, since a workplace-internal stage is not a `needforgood` ware. */
function withFeedStages(
  ctx: SystemContext,
  picked: readonly number[],
  recipes: ReadonlyMap<number, Recipe>,
): readonly number[] {
  const pool = new Set(picked);
  for (const good of picked) {
    for (const input of recipes.get(good)?.inputs ?? []) {
      if (livestockTribeOfGood(ctx.content, input.goodType) !== null && recipes.has(input.goodType)) {
        pool.add(input.goodType);
      }
    }
  }
  return [...pool];
}

/**
 * Start one cycle of `operator`'s next product choice, or nothing when no chosen product can start. The walk
 * takes the first startable product from the rotation cursor and advances the cursor past it, so alternation
 * resumes after the started product; a blocked one stays in the walk and is retried at the next start rather
 * than skipped forever. A first-ever start stamps an empty selection so the rotation position persists.
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
    if (!canStartCycle(world, ctx, building, recipe)) continue;
    beginCycle(world, ctx, building, recipe, good);
    if (selection === undefined) world.add(operator, CraftSelection, { goods: [], cursor: 0 });
    world.mut(operator, CraftSelection).cursor = (cursor + i + 1) % pool.length;
    return;
  }
}
