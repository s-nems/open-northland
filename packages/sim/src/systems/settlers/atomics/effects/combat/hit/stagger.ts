import { CurrentAtomic, Settler } from '../../../../../../components/index.js';
import { fx } from '../../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import type { SystemContext } from '../../../../../context.js';
import { atomicAnimationName, atomicDuration } from '../../../../../readviews/animations.js';
import { isInterruptibleAtomic } from '../../../../../readviews/index.js';

/**
 * The flinch slot, the original's `setatomic <job> 82 "..._attacked"` binding in
 * `DataCnmd/tribetypes12/tribetypes.ini`. A class flinches only when its `(tribe, job)` binds this row: of
 * the playable civilizations that is the civilian classes, plus the monster tribes' creature-soldiers. The
 * atomic carries an `idle` effect, so the flinch is purely occupancy.
 */
const ATTACKED_ATOMIC_ID = 82;

/** One deferred stagger, collected at hit time and applied only after the hit loop. */
export interface PendingStagger {
  readonly victim: Entity;
  readonly duration: number;
}

/**
 * Give each struck survivor its flinch atomic, deferred past the hit pass's own loop. Adding a
 * `CurrentAtomic` to the store that pass iterates would let a victim visited later advance its own fresh
 * stagger the same tick, coupling the result to iteration order; deferring makes the flinch begin
 * advancing the next tick. Two hits on one victim push the same atomic, so last-wins is harmless.
 */
export function applyPendingStaggers(world: World, pendingStaggers: readonly PendingStagger[]): void {
  for (const { victim, duration } of pendingStaggers) {
    world.add(victim, CurrentAtomic, {
      atomicId: ATTACKED_ATOMIC_ID,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
  }
}

/**
 * Decide whether a struck survivor flinches and collect it for {@link applyPendingStaggers}.
 *
 * Interruptibility is checked here, at the hit, not at the deferred add. A victim mid-swing or already
 * mid-flinch is `interruptable 0` in the data and is not re-staggered, so there is no stunlock.
 */
export function collectStagger(
  world: World,
  ctx: SystemContext,
  target: Entity,
  pendingStaggers: PendingStagger[],
): void {
  const victim = world.tryGet(target, Settler);
  if (victim === undefined) return;
  const staggerAnim = atomicAnimationName(ctx.content, victim, ATTACKED_ATOMIC_ID);
  if (staggerAnim === undefined) return; // no `82` binding, so this class does not flinch
  const current = world.tryGet(target, CurrentAtomic);
  if (current !== undefined) {
    const currentAnim = atomicAnimationName(ctx.content, victim, current.atomicId);
    // An action with no timing record is treated as non-interruptible rather than preempted.
    if (currentAnim === undefined || !isInterruptibleAtomic(ctx.content, currentAnim)) return;
  }
  pendingStaggers.push({ victim: target, duration: atomicDuration(ctx.content, victim, ATTACKED_ATOMIC_ID) });
}
