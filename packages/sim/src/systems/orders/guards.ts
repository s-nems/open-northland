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
import { atomicClipName, isInterruptibleAtomic } from '../readviews/animations.js';

/** Whether `e` is a living, owned settler the player may issue a command to. A dead, non-settler, or
 *  unowned target is a recoverable no-op. Handlers that also need a Position or Health keep those extra
 *  checks inline. */
export function isOrderableSettler(world: World, e: Entity): boolean {
  return world.isAlive(e) && world.has(e, Settler) && world.has(e, Owner);
}

/** Whether the player may set `e`'s trade or post it to a workplace. Beyond {@link isOrderableSettler}: a
 *  still-growing child ({@link Age}) is the GrowthSystem's to class, not the player's, and a woman keeps
 *  the woman role for life. Authored, faithful to the original's male-only trade model; a woman's work is
 *  the household, hoarding food home and bearing children. */
export function isTradeAssignable(world: World, e: Entity): boolean {
  return isOrderableSettler(world, e) && !world.has(e, Age) && !world.has(e, Female);
}

/**
 * Park `command` behind a running non-interruptible atomic instead of cancelling it. Callers must run their
 * own refusal checks first, because a refused order must not park. Returns `true` when the order was parked,
 * for the deferred-order system to re-dispatch the tick the atomic completes; `false` when the settler is
 * free or its clip may be interrupted. Parking overwrites any earlier parked order: latest order wins.
 */
export function deferOrderDuringAtomic(
  world: World,
  ctx: SystemContext,
  e: Entity,
  command: DeferrableOrderCommand,
): boolean {
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic === undefined) return false;
  const clip = atomicClipName(ctx.content, world.get(e, Settler), atomic.atomicId);
  if (clip !== undefined && isInterruptibleAtomic(ctx.content, clip)) return false;
  // Copied, not aliased: the caller's command object also sits in the replay log, and a shared reference
  // would let a post-enqueue mutation silently rewrite hashed component state.
  world.add(e, DeferredOrder, { command: { ...command } });
  return true;
}
