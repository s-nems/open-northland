import type { ContentSet } from '@open-northland/data';
import {
  addCurrentAtomic,
  Building,
  Carrying,
  CurrentAtomic,
  type HaulingLift,
  MoveGoal,
  Position,
  Settler,
  type SettlerIdentity,
  StandIn,
} from '../../../components/index.js';
import type { AtomicEffect } from '../../../core/atomic-effect.js';
import { contentIndex, jobAllowsAtomic } from '../../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../../context.js';
import { collectStandOf } from '../../footprint/index.js';
import { clearNavState } from '../../movement/nav-state.js';
import { faceToward } from '../../movement/turning.js';
import { atomicClipName, atomicDuration } from '../../readviews/animations.js';
import { isCandyMeal } from '../../readviews/food.js';
import { accessibleStockAmounts, refillingGoodsOf } from '../../stores/index.js';
import {
  beginCartLift,
  carriesBetweenCartAndDoor,
  carryCapacityOf,
  cartStandNear,
  haulingCartLiftTicks,
  liftsWithHaulingCart,
  pullsHaulingCart,
} from '../../vehicles/hauling-cart.js';
import type { PlannerContext } from '../planner/context.js';
import { interactionCell, unclaimedStockOf } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import { atomicHoldsSettler } from './busy.js';
import { pickBerry, takeMealUnit } from './effects/goods/index.js';

// An atomic id is only a content cross-reference and animation join key, pinned to the original's
// `setatomic` bindings; the typed {@link AtomicEffect} carries the behavior the AtomicSystem applies.

/** The three short idle slots (`setatomic <job> 2..4`, `logicdefines.inc` `IDLE_SHORT_A` to `IDLE_SHORT_C`). */
export const IDLE_SHORT_ATOMIC_IDS: readonly number[] = [2, 3, 4];

/** The medium idle slot (`setatomic <job> 5`, `logicdefines.inc` `IDLE_MEDIUM`). */
export const IDLE_MEDIUM_ATOMIC_ID = 5;

/**
 * The eat slot across every tribe's `setatomic <job> 10 "..._eat_slot_food"` bindings.
 */
export const EAT_ATOMIC_ID = 10;

/** The candy eat slot, `setatomic <job> 11 "..._eat_slot_candy"`: its clip pays more food than the plain
 *  slot's and some company on top (`atomicanimations.ini`). */
export const EAT_CANDY_ATOMIC_ID = 11;

/**
 * The eat slot a meal of `goodType` plays. Original behavior: food_extra and candy play the candy slot
 * when the eater's job allows it (`jobtypes.ini` `allowatomic 11`; every soldier forbids it), every other
 * food the plain slot. The candy slot also needs a clip this settler resolves, or the meal would pay
 * nothing.
 */
export function mealAtomicId(content: ContentSet, settler: SettlerIdentity, goodType: number): number {
  const candy =
    isCandyMeal(content, goodType) &&
    jobAllowsAtomic(content, settler.jobType, EAT_CANDY_ATOMIC_ID) &&
    atomicClipName(content, settler, EAT_CANDY_ATOMIC_ID) !== undefined;
  return candy ? EAT_CANDY_ATOMIC_ID : EAT_ATOMIC_ID;
}

/** What a meal eats: one unit of a good off a store or the eater's own back, or a bush's serving. */
export type Serving =
  | { readonly kind: 'eat'; readonly goodType: number; readonly from: Entity | null }
  | { readonly kind: 'forage'; readonly bush: Entity };

/**
 * Start a meal by taking its `serving` off the source: the eat slot {@link mealAtomicId} picks for the
 * good, or the plain slot for a bush's fruit. False, starting nothing, when the source no longer holds
 * the serving, so no clip feeds an eater on a unit somebody else took. The clip is the whole meal
 * (raise, chew, lower), so its length is the atomic's; most working trades bind no eat clip and play
 * the civilist's.
 */
export function startMeal(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  serving: Serving,
): boolean {
  if (serving.kind === 'forage') {
    if (!pickBerry(world, ctx, serving.bush)) return false;
    const duration = atomicDuration(ctx.content, settler, EAT_ATOMIC_ID);
    startAtomic(world, e, EAT_ATOMIC_ID, { kind: 'forage' }, duration, serving.bush);
    return true;
  }
  if (!takeMealUnit(world, ctx, e, serving.from, serving.goodType)) return false;
  const atomicId = mealAtomicId(ctx.content, settler, serving.goodType);
  // A loose pile eaten to nothing is gone, and the clip faces nothing.
  const source = serving.from ?? e;
  const target = world.isAlive(source) ? source : null;
  startAtomic(world, e, atomicId, serving, atomicDuration(ctx.content, settler, atomicId), target);
  return true;
}

/**
 * Start a sip of the carried draught in misc `slot` on the plain eat slot's clip, for a good that
 * `stopsToDrink`. Its sound cues carry `sip`, since the clip's own sound is chewing and the data has no
 * drinking sound.
 */
export function startDrink(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  draught: { readonly slot: number; readonly goodType: number },
): void {
  const effect = { kind: 'drink', slot: draught.slot, goodType: draught.goodType } as const;
  startAtomic(world, e, EAT_ATOMIC_ID, effect, atomicDuration(ctx.content, settler, EAT_ATOMIC_ID), e);
}

/**
 * The sleep slot across every tribe's `setatomic <job> 8 "..._sleep"` bindings, which cover the age
 * classes and the civilist/soldier only (jobs 1-6 and 31); a working trade plays the civilist's.
 */
export const SLEEP_ATOMIC_ID = 8;

/**
 * The original's `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY = 12`, bound `setatomic 6 12 "..._pray"` for the
 * civilist job across tribes.
 */
export const PRAY_ATOMIC_ID = 12;

/**
 * The original's EXERCISE action, bound `setatomic 6 89 "..._exercise"` for the civilist across tribes.
 * Every trade drills on this clip through the civilist fallback.
 */
export const EXERCISE_ATOMIC_ID = 89;

/** The original's generic pickup=22; like {@link PILEUP_ATOMIC_ID} the readable data binds no per-good
 *  pickup. A house may name its own shelf action instead ({@link collectAtomicOf}). */
export const PICKUP_ATOMIC_ID = 22;

/** The build-house slot bound for the builder job across every tribe (source basis
 *  `DataCnmd/tribetypes12/tribetypes.ini` and the builder's `allowatomic 39` in `jobtypes.ini`). */
export const BUILD_HOUSE_ATOMIC_ID = 39;

export { BUILD_ROAD_ATOMIC_ID, BUILD_WALL_ATOMIC_ID } from '../../../core/content-index/atomics.js';

/** Construction labor belongs to the builder trade. Other jobs may expose the same atomic for their
 *  animation set, so atomic permission alone does not establish the construction role. */
export function jobCanBuild(content: ContentSet, jobType: number): boolean {
  const index = contentIndex(content);
  return (
    index.jobs.get(jobType)?.id === 'builder' &&
    index.atomicsByJob.get(jobType)?.has(BUILD_HOUSE_ATOMIC_ID) === true
  );
}

/** Depositing a carried load into a store. The readable data binds no per-good pileup atomic: harvest and
 *  produce are good-keyed, pickup=22 and pileup are generic. */
export const PILEUP_ATOMIC_ID = 23;

/** Setting a carried load down. Approximation: the readable data binds no putdown clip (no `drop` atomic
 *  in `atomicanimations` or `setatomic`), so the drop reuses the pickup gesture. */
export const DROP_ATOMIC_ID = PICKUP_ATOMIC_ID;

/**
 * Start a settler setting its carried load down. Clearing the nav state is what makes the drop a
 * standstill: a settler interrupted mid-walk halts and sets the load down instead of dropping on the move.
 * A carrier pulling its hauling cart never sets the cart's load down by hand: it stays aboard until a
 * lift unloads it or the cart is set down with it.
 */
export function startDrop(world: World, ctx: SystemContext, settler: Entity): void {
  if (atomicHoldsSettler(world, settler) || pullsHaulingCart(world, settler)) return;
  const s = world.tryGet(settler, Settler);
  if (s === undefined || !world.has(settler, Carrying)) return;
  clearNavState(world, settler);
  addCurrentAtomic(world, settler, {
    atomicId: DROP_ATOMIC_ID,
    duration: atomicDuration(ctx.content, s, DROP_ATOMIC_ID),
    effect: { kind: 'drop' },
    targetEntity: null,
    targetTile: null,
  });
}

/**
 * Start a {@link CurrentAtomic} on a settler. `duration` is the animation length in ticks, clamped to at
 * least 1 by the executor; `target` is the action's object, recorded for render and inspection, and null
 * for a self-directed action.
 */
export function startAtomic(
  world: World,
  settler: Entity,
  atomicId: number,
  effect: AtomicEffect,
  duration: number,
  target: Entity | null,
): void {
  addCurrentAtomic(world, settler, {
    atomicId,
    duration,
    effect,
    targetEntity: target,
    targetTile: null,
  });
}

/** Run `start` on `cell`, or walk there. A walker routing stood in beside an occupied `cell` acts from where
 *  it stands, since the node will not free up for it. */
export function atOrWalk(world: World, e: Entity, here: NodeId, cell: NodeId, start: () => void): void {
  const stood = world.tryGet(e, StandIn);
  if (cell === here || (stood !== undefined && stood.goal === cell && stood.at === here)) {
    world.remove(e, StandIn);
    start();
  } else {
    world.add(e, MoveGoal, { cell });
  }
}

/** The action lifting goods off `store`'s shelf: the house's own `collectAtomic` (the well pump, the hive
 *  pick-up), else the generic pick-up; a store that is no building has only the generic one. */
export function collectAtomicOf(world: World, ctx: ContentContext, store: Entity): number {
  const building = world.tryGet(store, Building);
  if (building === undefined) return PICKUP_ATOMIC_ID;
  return contentIndex(ctx.content).buildings.get(building.buildingType)?.collectAtomic ?? PICKUP_ATOMIC_ID;
}

/**
 * Issue the `pickup` atomic against the store or pile `from`. The `pickup` effect caps the move at what
 * the source actually holds, so `amount` is a request, not a guarantee.
 */
export function startPickup(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  from: Entity,
  goodType: number,
  amount: number,
): void {
  const atomicId = collectAtomicOf(world, ctx, from);
  startAtomic(
    world,
    e,
    atomicId,
    { kind: 'pickup', goodType, amount, from },
    atomicDuration(ctx.content, settler, atomicId),
    from,
  );
}

/** The ticks a hand-over at `at` takes a puller whose cart stands: the clip's own inside a house, the
 *  cart kind's lift beside a ground pile, where the unit moves between pile and hold in one go. */
function cartHandoverTicks(
  world: World,
  ctx: SystemContext,
  e: Entity,
  at: Entity,
  clipTicks: number,
): number {
  return carriesBetweenCartAndDoor(world, at)
    ? clipTicks
    : haulingCartLiftTicks(world, ctx.content, e, clipTicks);
}

/** How long a puller come to a house stands with the cart in hand before it lets go of it (named
 *  addition: without the beat the cart reads as dropped mid-stride). */
const CART_HALT_TICKS = TICKS_PER_SECOND / 3;

/** Halt at the cart's stand with the cart still in hand, then stand it down: for `lift`, or parked. */
export function startCartHalt(world: World, e: Entity, lift: HaulingLift | null): void {
  startAtomic(world, e, REFILL_WAIT_ATOMIC_ID, { kind: 'cartHalt', lift }, CART_HALT_TICKS, null);
}

/**
 * A carrier with its hauling cart lifts off the store or pile `from`, one unit a lift: the cart is stood
 * down here if still in hand, which at a house is all this does, after a halt ({@link startCartHalt}), the
 * carrier walking on to the door from its stand ({@link cartStandOrCell}); else one `haulLoad` plays; the planner's hauling-cart rung plays the next
 * while the lift continues ({@link cartLiftContinues}).
 */
export function startCartLoad(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  from: Entity,
  goodType: number,
  units: number,
): void {
  const lift: HaulingLift = { kind: 'load', from, goodType, units };
  if (pullsHaulingCart(world, e) && carriesBetweenCartAndDoor(world, from)) {
    startCartHalt(world, e, lift);
    return;
  }
  beginCartLift(world, ctx, e, lift);
  const atomicId = collectAtomicOf(world, ctx, from);
  startAtomic(
    world,
    e,
    atomicId,
    { kind: 'haulLoad', from, goodType },
    cartHandoverTicks(world, ctx, e, from, atomicDuration(ctx.content, settler, atomicId)),
    from,
  );
}

/** The unload twin of {@link startCartLoad}: one unit of `goodType`, as the hold books it, into `store`
 *  a lift, out of the carrier's hands at a house or the standing cart beside a pile. */
export function startCartUnload(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  store: Entity,
  goodType: number,
): void {
  const lift: HaulingLift = { kind: 'unload', store, goodType, refused: false };
  if (pullsHaulingCart(world, e) && carriesBetweenCartAndDoor(world, store)) {
    startCartHalt(world, e, lift);
    return;
  }
  beginCartLift(world, ctx, e, lift);
  startAtomic(
    world,
    e,
    PILEUP_ATOMIC_ID,
    { kind: 'haulUnload', store, goodType },
    cartHandoverTicks(world, ctx, e, store, atomicDuration(ctx.content, settler, PILEUP_ATOMIC_ID)),
    store,
  );
}

/** Turn the puller to its standing cart, which it lifts out of and sets into from the node beside it. */
function faceCart(world: World, e: Entity, vehicle: Entity): void {
  const from = world.tryGet(e, Position);
  const to = world.tryGet(vehicle, Position);
  if (from !== undefined && to !== undefined) faceToward(world, e, from, to);
}

/** Beside the standing cart: set what the hands hold into the hold, the lift lasting what the cart's
 *  kind sets ({@link haulingCartLiftTicks}). */
export function startCartStow(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  vehicle: Entity,
): void {
  faceCart(world, e, vehicle);
  startAtomic(
    world,
    e,
    PILEUP_ATOMIC_ID,
    { kind: 'cartStow', vehicle },
    haulingCartLiftTicks(world, ctx.content, e, atomicDuration(ctx.content, settler, PILEUP_ATOMIC_ID)),
    vehicle,
  );
}

/** The fetch twin of {@link startCartStow}: one unit of `goodType` out of the hold into the hands. */
export function startCartFetch(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  vehicle: Entity,
  goodType: number,
): void {
  faceCart(world, e, vehicle);
  startAtomic(
    world,
    e,
    PICKUP_ATOMIC_ID,
    { kind: 'cartFetch', vehicle, goodType },
    haulingCartLiftTicks(world, ctx.content, e, atomicDuration(ctx.content, settler, PICKUP_ATOMIC_ID)),
    vehicle,
  );
}

/** Walk to `from` and lift a carry-load of `goodType` (the settler's hands, or its hauling cart's free
 *  hold on top), at most `most` units, claiming the units still unclaimed there first so a settler planned
 *  after this one picks another source while it walks. */
export function walkPickupBatch(
  plan: PlannerContext,
  from: Entity,
  goodType: number,
  cell?: NodeId,
  most = Number.POSITIVE_INFINITY,
): void {
  const { world, ctx, entity: e, supply } = plan;
  const capacity = Math.min(most, carryCapacityOf(world, ctx.content, e));
  const claimed = Math.min(capacity, unclaimedStockOf(world, ctx, supply, from, goodType));
  if (claimed > 0) supply.stampPickupClaim(e, { source: from, goodType, amount: claimed });
  walkThenLift(plan, from, goodType, capacity, undefined, cell);
}

/**
 * A workshop input fetch of up to `amount` units: {@link walkPickupBatch}, except a walk to a self-filling
 * house of the good (`refills`, the source search's verdict) claims nothing there, since the original's
 * reservation never stops a second fetcher and a far walker must not hold the refill up. The zero claim
 * still names the source for the workplace's inbound count.
 */
export function walkFetchInput(
  plan: PlannerContext,
  from: Entity,
  goodType: number,
  refills: boolean,
  amount: number,
): void {
  const { world, ctx, entity: e, supply } = plan;
  const claimed = refills ? 0 : Math.min(amount, unclaimedStockOf(world, ctx, supply, from, goodType));
  if (claimed > 0 || refills) supply.stampPickupClaim(e, { source: from, goodType, amount: claimed });
  walkThenLift(plan, from, goodType, amount, refills);
}

/**
 * Where a settler bound for `at` walks: `cell`, the node it works `at` from, or, pulling a hauling cart to
 * a house, the cart's stand short of the door ({@link cartStandNear}), where it lets go of the cart and
 * walks the rest on foot.
 */
export function cartStandOrCell(plan: PlannerContext, at: Entity, cell: NodeId): NodeId {
  const { world, ctx, terrain, entity: e, here } = plan;
  if (!pullsHaulingCart(world, e) || !carriesBetweenCartAndDoor(world, at)) return cell;
  return cartStandNear(world, ctx, terrain, cell, here, unreachableGoalVeto(world, ctx, e)) ?? cell;
}

/** The first short idle slot (`setatomic <job> 2`), played by a fetcher waiting at an empty well or hive. */
const REFILL_WAIT_ATOMIC_ID = 2;

/**
 * Walk to `from`, at the stand its own collect action plays from or else its door, then start the pickup.
 * Original behavior: at a self-filling house of the good the clip starts while the shelf holds a unit,
 * whatever is claimed, so parallel lifters may start; the first clip to finish takes it and the rest end
 * empty-handed. On an empty shelf the original idles a clip and searches
 * again; here the settler idles, keeping its errand, until the tick after the next refill beat.
 * `refills` is the caller's verdict on `from`, else judged on arrival at an empty shelf.
 */
function walkThenLift(
  plan: PlannerContext,
  from: Entity,
  goodType: number,
  amount: number,
  refills?: boolean,
  cell?: NodeId,
): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  const door =
    cell ?? collectStandOf(world, ctx, terrain, from) ?? interactionCell(world, ctx, terrain, from, here);
  atOrWalk(world, e, here, cartStandOrCell(plan, from, door), () => {
    const empty = (accessibleStockAmounts(world, from)?.get(goodType) ?? 0) <= 0;
    if (empty && (refills ?? refillingGoodsOf(world, ctx, from).includes(goodType))) {
      startRefillWait(world, ctx, e);
    } else if (liftsWithHaulingCart(world, e)) {
      startCartLoad(world, ctx, e, plan, from, goodType, amount);
    } else {
      startPickup(world, ctx, e, plan, from, goodType, amount);
    }
  });
}

/** Idle at an empty well or hive until the tick after its next refill beat, keeping the errand. */
export function startRefillWait(world: World, ctx: SystemContext, e: Entity): void {
  startAtomic(world, e, REFILL_WAIT_ATOMIC_ID, { kind: 'idle' }, ticksPastNextRefill(ctx.tick), null);
}

/** The wait's length from `tick`, counted: it ends on the next refill beat, `tick` included, and the refill
 *  runs after the planner on its beat, so the waiter plans again on the tick after and finds the unit. */
function ticksPastNextRefill(tick: number): number {
  return ((TICKS_PER_SECOND - (tick % TICKS_PER_SECOND)) % TICKS_PER_SECOND) + 1;
}
