import {
  Age,
  CurrentAtomic,
  type DeferrableOrderCommand,
  DeferredOrder,
  Female,
  Owner,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isInterruptibleAtomic, needAtomicAnimationName } from '../readviews/animations.js';

/** Whether `e` is a living, owned settler the player may issue a command to — the shared target guard
 *  for the profession, stance, and work-flag order handlers. A dead/stale, non-settler, or neutral
 *  (unowned) target is a recoverable no-op (still logged for faithful replay). Handlers that also need a
 *  {@link import('../../components/movement.js').Position} or {@link import('../../components/combat.js').Health}
 *  keep those extra checks inline. */
export function isOrderableSettler(world: World, e: Entity): boolean {
  return world.isAlive(e) && world.has(e, Settler) && world.has(e, Owner);
}

/** Whether the player may set `e`'s trade or post it to a workplace. Beyond {@link isOrderableSettler}: a
 *  still-growing child ({@link Age}) is the GrowthSystem's to class, not the player's, and a woman keeps the
 *  woman role for life — the trades are male (faithful to the original's job model; user decision
 *  2026-07-16), her work being the household: hoarding food home and bearing children. */
export function isTradeAssignable(world: World, e: Entity): boolean {
  return isOrderableSettler(world, e) && !world.has(e, Age) && !world.has(e, Female);
}

/**
 * Park `command` behind a running NON-interruptible atomic instead of cancelling it — the shared gate the
 * deferrable order handlers call after their own refusal checks (a refused order must not park). Returns
 * `true` when the order was parked (the {@link import('./pending.js').deferredOrderSystem} re-dispatches it
 * the tick the atomic completes); `false` when the settler is free or its clip may be interrupted, so the
 * handler proceeds. The playing clip resolves via {@link needAtomicAnimationName}; its flag (and the
 * unmarked/unresolved-defaults-to-non-interruptible approximation) is {@link isInterruptibleAtomic}'s.
 * Parking overwrites any earlier parked order: latest-order-wins.
 */
export function deferOrderDuringAtomic(
  world: World,
  ctx: SystemContext,
  e: Entity,
  command: DeferrableOrderCommand,
): boolean {
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic === undefined) return false;
  const clip = needAtomicAnimationName(ctx.content, world.get(e, Settler), atomic.atomicId);
  if (clip !== undefined && isInterruptibleAtomic(ctx.content, clip)) return false;
  // Copied, not aliased: the caller's command object also sits in the replay log, and a shared reference
  // would let a post-enqueue mutation silently rewrite hashed component state.
  world.add(e, DeferredOrder, { command: { ...command } });
  return true;
}
