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
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../../context.js';
import { clearNavState } from '../../movement/nav-state.js';
import { atomicClipNameAtHome, atomicDuration, atomicDurationForName } from '../../readviews/animations.js';
import type { PlannerContext } from '../planner/context.js';
import { interactionCell } from '../targets/index.js';
import { atomicHoldsSettler } from './busy.js';

// An atomic id is only a content cross-reference and animation join key, pinned to the original's
// `setatomic` bindings; the typed {@link AtomicEffect} carries the behavior the AtomicSystem applies.

/**
 * The eat slot across every tribe's `setatomic <job> 10 "..._eat_slot_food"` bindings.
 */
export const EAT_ATOMIC_ID = 10;

/**
 * Duration in ticks of one eat or forage atomic, from the settler's own eat clip
 * (`viking_civilist_eat_slot_food` = 50 ticks). The `[gfxanimatomic]` action-10 frame list raises, chews
 * and lowers, so the clip is a whole meal. Most working trades bind no eat clip and play the civilist's.
 */
export function eatDuration(ctx: SystemContext, settler: SettlerIdentity): number {
  return atomicDuration(ctx.content, settler, EAT_ATOMIC_ID);
}

/**
 * The sleep slot across every tribe's `setatomic <job> 8 "..._sleep"` bindings, which cover the age
 * classes and the civilist/soldier only (jobs 1-6 and 31); a working trade plays the civilist's.
 */
export const SLEEP_ATOMIC_ID = 8;

/** How long `atomicId` takes indoors at home: the at-home twin's length where the data authors one, else
 *  the same clip's length as anywhere else. */
export function atHomeDuration(ctx: SystemContext, settler: SettlerIdentity, atomicId: number): number {
  return atomicDurationForName(ctx.content, atomicClipNameAtHome(ctx.content, settler, atomicId));
}

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

/** The source-bound wall-builder action used for the one-wood finish and repairs. */
export const BUILD_WALL_ATOMIC_ID = 42;

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

export function walkPickupBatch(plan: PlannerContext, from: Entity, goodType: number): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, from, here), () =>
    startPickup(world, ctx, e, plan, from, goodType, CARRY_CAPACITY),
  );
}
