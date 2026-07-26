import type { Recipe } from '@open-northland/data';
import { CraftSelection } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { beginCycle, canStartCycle } from './cycles.js';

// The per-operator product-ROTATION policy: which of its workplace's products a starting operator picks next.
// The cycle model it starts through is ./cycles.ts; the loop that calls this is ../production.ts.

/**
 * Start one cycle of `operator`'s next product choice, or nothing when no chosen product can start.
 * The choice walks the operator's rotation — its {@link CraftSelection} goods, or every product of the
 * workplace when it has none (or when its picks name nothing this workplace makes — an orphaned pick
 * degrades to all-products rather than stalling) — from the rotation cursor, taking the first startable
 * product and advancing the cursor past it (so alternation resumes after the started product, and a blocked
 * product is retried next start instead of being skipped forever). A first-ever start stamps the
 * "all products" selection so the worker's rotation position persists.
 *
 * The pool is further narrowed to the products this operator has EARNED: a `needforgood` XP threshold
 * ({@link settlerMeetsNeed}) locks a ware until the operator's repeats clear it — a fresh smith forges
 * only the ungated wares and grows into the rest (source basis: observed original behaviour — locked
 * products are absent from a young craftsman's output; the profession-progression toggle lifts it).
 */
export function startCycleFor(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): void {
  let selection = world.tryGet(operator, CraftSelection);
  const subject = needSubjectOf(world, operator);
  const earned = (good: number): boolean => settlerMeetsNeed(world, ctx, subject, 'good', good);
  const picked =
    selection !== undefined && selection.goods.length > 0
      ? selection.goods.filter((g) => recipes.has(g) && earned(g))
      : [];
  // A selection naming nothing this workplace makes — or nothing this operator has EARNED — degrades
  // to the (earned) all-products default, like the gather pick's graceful fallback: employment changes
  // clear picks, but a content rebase or a raw command can still orphan one, and an orphaned pick must
  // not stall a staffed workshop.
  const pool = picked.length > 0 ? picked : [...recipes.keys()].filter(earned);
  if (pool.length === 0) return; // no recipes at all, or none this operator has earned yet
  const cursor = selection?.cursor ?? 0;
  for (let i = 0; i < pool.length; i++) {
    const good = pool[(cursor + i) % pool.length];
    const recipe = good !== undefined ? recipes.get(good) : undefined;
    if (good === undefined || recipe === undefined) continue;
    if (!canStartCycle(world, ctx, building, recipe)) continue;
    beginCycle(world, building, recipe, good);
    if (selection === undefined) {
      world.add(operator, CraftSelection, { goods: [], cursor: 0 });
      selection = world.get(operator, CraftSelection);
    }
    selection.cursor = (cursor + i + 1) % pool.length;
    world.touch(operator); // an in-place component write — evict any cached snapshot clone
    return;
  }
}
