import type { Recipe } from '@open-northland/data';
import { CraftSelection } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
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
 */
export function startCycleFor(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): void {
  let selection = world.tryGet(operator, CraftSelection);
  const picked =
    selection !== undefined && selection.goods.length > 0
      ? selection.goods.filter((g) => recipes.has(g))
      : [];
  // A selection naming nothing this workplace makes degrades to the all-products default (like the
  // gather pick's graceful fallback) — employment changes clear picks, but a content rebase can still
  // orphan one, and an orphaned pick must not stall a staffed workshop.
  const pool = picked.length > 0 ? picked : [...recipes.keys()];
  if (pool.length === 0) return; // a workplace with no recipes at all
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
