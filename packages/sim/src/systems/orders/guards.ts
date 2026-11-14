import type { ContentSet } from '@open-northland/data';
import {
  Age,
  AiOrder,
  BuildMode,
  CurrentAtomic,
  type DeferrableOrderCommand,
  DeferredOrder,
  ExploreOrder,
  Female,
  hasMissionBehaviour,
  MealBreak,
  MISSION_BEHAVIOUR,
  OrderQueue,
  Owner,
  Settler,
  SiteAssignment,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { releaseSiteClaim } from '../economy/site-claim.js';
import { isAdultSettler } from '../family/eligibility.js';
import { atomicClipName, isInterruptibleAtomic } from '../readviews/animations.js';
import { isHeroJob } from '../readviews/jobs.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { callOffCoinDrill } from '../settlers/drives/coin-drill-coins.js';

/** Whether `e` is a living, owned settler the player may issue a command to. A dead, non-settler, or
 *  unowned target is a recoverable no-op. Handlers that also need a Position or Health keep those extra
 *  checks inline. */
export function isOrderableSettler(world: World, e: Entity): boolean {
  return world.isAlive(e) && world.has(e, Settler) && world.has(e, Owner);
}

/** Whether the player may set `e`'s trade or post it to a workplace. Beyond {@link isOrderableSettler}: a
 *  still-growing child ({@link Age}) is the GrowthSystem's to class, not the player's, and a woman keeps
 *  the woman role for life. Authored, faithful to the original's male-only trade model; a woman's work is
 *  the household, hoarding food home and bearing children. A hero keeps his class for life too, and
 *  `jobtypes.ini` lets no hero class hold a workplace (`canHaveWorkHouseFlag 0`). */
export function isTradeAssignable(world: World, content: ContentSet, e: Entity): boolean {
  return (
    isOrderableSettler(world, e) &&
    !world.has(e, Age) &&
    !world.has(e, Female) &&
    !isHeroJob(content, world.get(e, Settler).jobType)
  );
}

/** {@link isTradeAssignable} for an order that would change the trade itself: a script may fix a
 *  unit's trade (`MISSIONS.md`, behaviour bit 6), which refuses the order before it cancels anything. */
export function mayChangeTrade(world: World, content: ContentSet, e: Entity): boolean {
  return isTradeAssignable(world, content, e) && !hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.JOB_LOCKED);
}

/** Whether `e` may be moved into a home: an owned grown settler other than a hero, who takes no building. */
export function mayTakeHome(world: World, content: ContentSet, e: Entity): boolean {
  return (
    isOrderableSettler(world, e) &&
    isAdultSettler(world, e) &&
    !isHeroJob(content, world.get(e, Settler).jobType)
  );
}

/**
 * Drop the earlier orders that would act on `e` later and cancel an order that takes it now: a parked
 * order replays the tick its atomic ends, a scout's sweep walks its next leg the tick the scout is free,
 * the queued orders start once the current one ends, and a coin drill would walk him back to the barracks.
 */
export function supersedeStandingOrders(world: World, ctx: SystemContext, e: Entity): void {
  callOffCoinDrill(world, ctx, e);
  world.remove(e, AiOrder);
  dropOrderQueue(world, e);
  world.remove(e, DeferredOrder);
  world.remove(e, ExploreOrder);
  endBuildMode(world, e);
}

/** Drop the orders `e` queued behind its current one, and a meal break holding them. Every order that
 *  takes the settler without queueing drops them: through {@link supersedeStandingOrders}, or directly
 *  where a handler keeps the rest. */
export function dropOrderQueue(world: World, e: Entity): void {
  world.remove(e, OrderQueue);
  world.remove(e, MealBreak);
}

/** Run `change`, the trade change a served drill or course ends in, keeping the orders queued behind it:
 *  a trade change drops them as a player's trade order does. */
export function keepingOrderQueue<T>(world: World, e: Entity, change: () => T): T {
  const queue = world.tryGet(e, OrderQueue);
  const kept = queue === undefined ? undefined : { orders: [...queue.orders], owner: queue.owner };
  const result = change();
  if (kept !== undefined && !world.has(e, OrderQueue)) world.add(e, OrderQueue, kept);
  return result;
}

/** Call off a builder's road or wall run, letting go of the site it had claimed for it. */
function endBuildMode(world: World, e: Entity): void {
  if (!world.has(e, BuildMode)) return;
  world.remove(e, BuildMode);
  releaseSiteClaim(world, e);
  world.remove(e, SiteAssignment);
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
  { scripted = false }: { readonly scripted?: boolean } = {},
): boolean {
  if (!atomicBlocksOrder(world, ctx, e)) return false;
  // Copied, not aliased: the caller's command object also sits in the replay log, and a shared reference
  // would let a post-enqueue mutation silently rewrite hashed component state.
  world.remove(e, AiOrder);
  world.add(e, DeferredOrder, { command: { ...command }, ...(scripted ? { scripted: true } : {}) });
  return true;
}

/** Whether `e` runs an atomic an order may not cut short: one that holds the settler and is not
 *  interruptible. */
export function atomicBlocksOrder(world: World, ctx: SystemContext, e: Entity): boolean {
  if (!atomicHoldsSettler(world, e)) return false;
  const clip = atomicClipName(ctx.content, world.get(e, Settler), world.get(e, CurrentAtomic).atomicId);
  return clip === undefined || !isInterruptibleAtomic(ctx.content, clip);
}
