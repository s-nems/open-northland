import { CurrentAtomic, Production } from '../../../../../components/index.js';
import { contentIndex } from '../../../../../core/content-index.js';
import { fx } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';

/**
 * Show the `batch`-th operator standing inside the workplace working batch `batch`, whose clock the clip
 * reads. Production advances one batch per present operator, oldest first, so that pairing holds and a
 * hand beyond the running batches performs nothing rather than doubling another's motion.
 *
 * Approximation: the batch is the clip's clock. In the source the clip is the cycle, authoring its own
 * deposit frame, and the viking craft clips run 50 to 400 ticks against the flat `DEFAULT_RECIPE_TICKS`,
 * itself a named approximation, so a clip is stretched or compressed onto the batch instead of setting
 * the pace.
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
  world.add(e, CurrentAtomic, {
    atomicId,
    elapsed: Math.min(cycle.elapsed, duration),
    // The executor derives the real fraction from `elapsed` later this tick, as it does for every atomic.
    progress: fx.fromInt(0),
    duration,
    effect: { kind: 'produce', recipeOutput: cycle.goodType },
    targetEntity: workplace,
    targetTile: null,
  });
}
