import { Production, Settler } from '../../components/index.js';
import { contentIndex, jobAllowsAtomic } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { craftablePool } from '../economy/production/rotation.js';
import { livestockTribeOfGood } from '../readviews/index.js';
import { assignedWorkers } from '../stores/assigned-workers.js';
import { recipesByProductOf } from '../stores/index.js';

/**
 * The species goods some settler employed at `farm` tends: its trade plays the species' produce atomic
 * and its production choice includes the species. A species with a breeding cycle still running counts
 * too, since a finite order spends its last unit when that cycle starts and the calf needs its parents
 * attached to be born. A farm holds animals only of these (named addition).
 */
export function tendedSpeciesOf(world: World, ctx: SystemContext, farm: Entity): ReadonlySet<number> {
  const tended = new Set<number>();
  const recipes = recipesByProductOf(world, ctx, farm);
  if (recipes === undefined) return tended;
  for (const cycle of world.tryGet(farm, Production)?.cycles ?? []) {
    if (livestockTribeOfGood(ctx.content, cycle.goodType) !== null) tended.add(cycle.goodType);
  }
  const goods = contentIndex(ctx.content).goods;
  for (const worker of assignedWorkers(world, farm)) {
    const job = world.tryGet(worker, Settler)?.jobType ?? null;
    if (job === null) continue;
    for (const good of craftablePool(world, ctx, worker, recipes)) {
      if (livestockTribeOfGood(ctx.content, good) === null) continue;
      const produce = goods.get(good)?.atomics.produce;
      if (produce != null && jobAllowsAtomic(ctx.content, job, produce)) tended.add(good);
    }
  }
  return tended;
}
