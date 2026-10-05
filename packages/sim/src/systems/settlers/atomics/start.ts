import type { ContentSet } from '@open-northland/data';
import {
  addCurrentAtomic,
  Building,
  CARRY_CAPACITY,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  Settler,
  type SettlerIdentity,
} from '../../../components/index.js';
import type { AtomicEffect } from '../../../core/atomic-effect.js';
import { contentIndex, jobAllowsAtomic } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../../context.js';
import { clearNavState } from '../../movement/nav-state.js';
import { atomicClipName, atomicDuration } from '../../readviews/animations.js';
import { isCandyMeal } from '../../readviews/food.js';
import type { PlannerContext } from '../planner/context.js';
import { interactionCell, unclaimedStockOf } from '../targets/index.js';
import { atomicHoldsSettler } from './busy.js';

// An atomic id is only a content cross-reference and animation join key, pinned to the original's
// `setatomic` bindings; the typed {@link AtomicEffect} carries the behavior the AtomicSystem applies.

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

/**
 * Start a meal: the eat slot {@link mealAtomicId} picks for the good, or the plain slot for a forage,
 * which eats the bush's fruit. The clip is the whole meal (raise, chew, lower), so its length is the
 * atomic's; most working trades bind no eat clip and play the civilist's.
 */
export function startMeal(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  effect: Extract<AtomicEffect, { kind: 'eat' | 'forage' }>,
  target: Entity | null,
): void {
  const atomicId =
    effect.kind === 'eat' ? mealAtomicId(ctx.content, settler, effect.goodType) : EAT_ATOMIC_ID;
  startAtomic(world, e, atomicId, effect, atomicDuration(ctx.content, settler, atomicId), target);
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
 */
export function startDrop(world: World, ctx: SystemContext, settler: Entity): void {
  if (atomicHoldsSettler(world, settler)) return;
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

export function atOrWalk(world: World, e: Entity, here: NodeId, cell: NodeId, start: () => void): void {
  if (cell === here) start();
  else world.add(e, MoveGoal, { cell });
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

/** Walk to `from` and lift a carry-load of `goodType`, claiming the units still unclaimed there first so a
 *  settler planned after this one picks another source while it walks. */
export function walkPickupBatch(plan: PlannerContext, from: Entity, goodType: number, cell?: NodeId): void {
  const { world, ctx, terrain, entity: e, here, supply } = plan;
  const claimed = Math.min(CARRY_CAPACITY, unclaimedStockOf(world, supply, from, goodType));
  if (claimed > 0) supply.stampPickupClaim(e, { source: from, goodType, amount: claimed });
  atOrWalk(world, e, here, cell ?? interactionCell(world, ctx, terrain, from, here), () =>
    startPickup(world, ctx, e, plan, from, goodType, CARRY_CAPACITY),
  );
}
