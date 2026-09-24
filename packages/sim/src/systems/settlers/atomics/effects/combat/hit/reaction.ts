import {
  addCurrentAtomic,
  CurrentAtomic,
  Engagement,
  NeedOrder,
  PlayerOrder,
  removeCurrentAtomic,
  Settler,
  type SettlerIdentity,
} from '../../../../../../components/index.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import type { SystemContext } from '../../../../../context.js';
import { clearNavState, isTravelling } from '../../../../../movement/nav-state.js';
import { atomicDuration, boundAtomicAnimation } from '../../../../../readviews/animations.js';
import { isInterruptibleAtomic, stanceFights, stanceMode } from '../../../../../readviews/index.js';

/**
 * The flinch slot, the original's `setatomic <job> 82 "..._attacked"` binding in
 * `DataCnmd/tribetypes12/tribetypes.ini`. A class flinches only when its `(tribe, job)` binds this row: of
 * the playable civilizations that is the civilian classes, plus the monster tribes' creature-soldiers. The
 * atomic carries an `idle` effect, so the flinch is purely occupancy.
 */
const ATTACKED_ATOMIC_ID = 82;

/**
 * One deferred reaction of a struck survivor, applied only after the hit loop: the flinch clip its class
 * binds, or - for a class with no flinch of its own - the end of what the blow interrupted. A sleeper
 * wakes; a fighting unit walking an errand of its own drops the errand, so the next planner tick leaves it
 * standing where the CombatSystem can fight back with it.
 */
export type PendingHitReaction =
  | { readonly kind: 'flinch'; readonly victim: Entity; readonly duration: number }
  | { readonly kind: 'wake'; readonly victim: Entity }
  | { readonly kind: 'halt'; readonly victim: Entity };

/**
 * Apply each struck survivor's reaction, deferred past the hit pass's own loop. Touching the atomic store
 * that pass iterates would let a victim visited later advance its own fresh clip the same tick, coupling
 * the result to iteration order; deferring makes the flinch begin advancing the next tick. Two hits on one
 * victim push the same reaction, so last-wins is harmless.
 */
export function applyPendingHitReactions(world: World, pending: readonly PendingHitReaction[]): void {
  for (const reaction of pending) {
    if (reaction.kind === 'wake') {
      removeCurrentAtomic(world, reaction.victim);
      continue;
    }
    if (reaction.kind === 'halt') {
      clearNavState(world, reaction.victim);
      continue;
    }
    addCurrentAtomic(world, reaction.victim, {
      atomicId: ATTACKED_ATOMIC_ID,
      duration: reaction.duration,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
  }
}

/**
 * Decide how a struck survivor reacts and collect it for {@link applyPendingHitReactions}.
 *
 * Interruptibility is checked here, at the hit, not at the deferred apply. A victim mid-swing or already
 * mid-flinch is `interruptable 0` in the data and is not re-staggered, so there is no stunlock. A blow ends
 * a sleep whatever the data says about the clip, and whoever the sleeper is: no stance, order or missing
 * flinch binding makes being cut down in one's sleep sensible behavior.
 */
export function collectHitReaction(
  world: World,
  ctx: SystemContext,
  target: Entity,
  pending: PendingHitReaction[],
): void {
  const victim = world.tryGet(target, Settler);
  if (victim === undefined) return;
  const current = world.tryGet(target, CurrentAtomic);
  const staggerAnim = boundAtomicAnimation(ctx.content, victim, ATTACKED_ATOMIC_ID);
  if (staggerAnim !== undefined && interruptible(ctx, victim, current)) {
    pending.push({
      kind: 'flinch',
      victim: target,
      duration: atomicDuration(ctx.content, victim, ATTACKED_ATOMIC_ID),
    });
    return;
  }
  if (current?.effect.kind === 'sleep') {
    pending.push({ kind: 'wake', victim: target });
    return;
  }
  if (walksItsOwnErrand(world, ctx, target, victim)) pending.push({ kind: 'halt', victim: target });
}

/**
 * Whether the struck victim is walking an errand of its own that being attacked should end. A fleeing or
 * ignoring unit keeps going, which is what those stances mean; a chase belongs to the CombatSystem, which
 * re-aims it rather than shedding it; and a walk the player ordered - a march or a meal - is the player's
 * to end. What is left is the settler's own errand, and the CombatSystem leaves a walker alone, so without
 * this a soldier crossing a battle on its way to a bed takes blows the whole way without turning round.
 *
 * A melee blow lands in the AtomicSystem, before the CombatSystem's pass, so the victim is already standing
 * when combat looks at it. An arrow lands after that pass, so an errand another drive re-issues the next
 * tick is only interrupted where that drive holds off too, as the battle alert holds off the needs rungs.
 */
function walksItsOwnErrand(
  world: World,
  ctx: SystemContext,
  target: Entity,
  victim: SettlerIdentity,
): boolean {
  if (!isTravelling(world, target) || world.has(target, Engagement)) return false;
  if (world.has(target, PlayerOrder) || world.has(target, NeedOrder)) return false;
  return stanceFights(stanceMode(world, ctx.content, target, victim.jobType));
}

/** Whether the clip the victim is running gives way to a flinch. An action with no timing record is treated
 *  as non-interruptible rather than preempted. */
function interruptible(
  ctx: SystemContext,
  victim: SettlerIdentity,
  current: { readonly atomicId: number } | undefined,
): boolean {
  if (current === undefined) return true;
  const currentAnim = boundAtomicAnimation(ctx.content, victim, current.atomicId);
  return currentAnim !== undefined && isInterruptibleAtomic(ctx.content, currentAnim);
}
