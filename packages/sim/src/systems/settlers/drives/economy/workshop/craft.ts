import { addCurrentAtomic, Production } from '../../../../../components/index.js';
import { contentIndex } from '../../../../../core/content-index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';

/**
 * Show the `batch`-th operator standing inside the workplace working batch `batch`, whose clock the clip
 * reads. Production advances one batch per present operator, oldest first, so that pairing holds and a
 * hand beyond the running batches performs nothing rather than doubling another's motion.
 *
 * The batch is the clip's clock. A staffed batch lasts the clip its starting operator resolves
 * (`production/rotation.ts`), so the clip plays at its own length; only a recipe-timed fallback batch
 * stretches or compresses it.
 */
export function startCraftAtomic(
  world: World,
  ctx: SystemContext,
  e: Entity,
  workplace: Entity,
  batch: number,
): void {
  const cycle = world.tryGet(workplace, Production)?.cycles[batch];
  if (cycle === undefined) return;
  const atomicId = contentIndex(ctx.content).goods.get(cycle.goodType)?.atomics.produce;
  if (atomicId === undefined) return;
  const duration = Math.max(1, cycle.duration);
  addCurrentAtomic(
    world,
    e,
    {
      atomicId,
      duration,
      effect: { kind: 'produce', recipeOutput: cycle.goodType },
      targetEntity: workplace,
      targetTile: null,
    },
    Math.min(cycle.elapsed, duration),
  );
}
