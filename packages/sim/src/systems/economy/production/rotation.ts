import type { Recipe } from '@open-northland/data';
import { CraftSelection } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { beginCycle, canStartCycle } from './cycles.js';

// The per-operator product-ROTATION policy: which of its workplace's products a starting operator picks next.
// The cycle model it starts through is ./cycles.ts; the loop that calls this is ../production.ts.

/**
 * The products of `recipes` this operator may craft, in rotation order: its {@link CraftSelection}
 * goods, else every product of the workplace, each narrowed to what the operator has EARNED (a
 * `needforgood` XP threshold, {@link settlerMeetsNeed}, locks a ware until the operator's repeats clear
 * it, so a fresh smith forges only the ungated wares and grows into the rest; source basis: observed
 * original behaviour, locked products are absent from a young craftsman's output, and the
 * profession-progression toggle lifts the gate). A selection naming nothing this workplace makes, or
 * nothing earned, degrades to that all-products default rather than stalling a staffed workshop.
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
 * Start one cycle of `operator`'s next product choice, or nothing when no chosen product can start.
 * The choice walks the operator's rotation ({@link craftablePool}) from the rotation cursor, taking the
 * first startable product and advancing the cursor past it (so alternation resumes after the started
 * product, and a blocked product is retried next start instead of being skipped forever). A first-ever
 * start stamps the "all products" selection so the worker's rotation position persists.
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
    beginCycle(world, building, recipe, good);
    if (selection === undefined) world.add(operator, CraftSelection, { goods: [], cursor: 0 });
    world.write(operator, CraftSelection, (s) => {
      s.cursor = (cursor + i + 1) % pool.length;
    });
    return;
  }
}
