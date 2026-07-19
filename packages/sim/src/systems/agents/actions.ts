import {
  CARRY_CAPACITY,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  Settler,
  type SettlerIdentity,
} from '../../components/index.js';
import type { AtomicEffect } from '../../core/atomic-effect.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { atomicDuration } from '../readviews/animations.js';
import { clearNavState } from '../spatial.js';
import type { PlannerContext } from './planner-context.js';
import { interactionCell } from './targets/index.js';

// The planner's action vocabulary: the atomic ids the drives issue, the shared "start an atomic" entry point,
// and the walk-or-act step every target-bound drive ends in. Each id below is only a content cross-reference /
// animation join key (pinned to the original's `setatomic` bindings — see each source basis); the typed
// {@link AtomicEffect} carries the behavior the AtomicSystem applies.

/**
 * The atomic id a settler runs to eat — id 10 is the eat slot across every tribe's
 * `setatomic <job> 10 "..._eat_slot_food"` bindings (see source basis). The `eat` effect consumes one unit of
 * food and resets hunger.
 */
export const EAT_ATOMIC_ID = 10;

/**
 * How many times the short extracted eat clip (`viking_eat` ≈ 5 ticks) repeats to make one meal, so a settler
 * visibly pauses to eat instead of snapping straight back to work (a single-clip bite reads as a flicker).
 *
 * Named approximation: the original eats over several event-driven animation beats whose exact count isn't
 * decoded; this is a tunable stand-in. It scales the clip (not a flat tick count) so a tribe with a longer eat
 * clip still eats proportionally longer.
 */
export const EAT_ANIMATION_REPEATS = 8;

/**
 * The duration (ticks) of one eat or forage atomic: the settler's eat-clip length repeated
 * {@link EAT_ANIMATION_REPEATS} times. Shared by every eat site (a store meal, a carried-load bite, a wild-bush
 * forage) so they all take the same visible beat — the one place the meal length is decided.
 */
export function eatDuration(ctx: SystemContext, settler: SettlerIdentity): number {
  return atomicDuration(ctx.content, settler, EAT_ATOMIC_ID) * EAT_ANIMATION_REPEATS;
}

/**
 * The atomic id a settler runs to sleep — id 8 is the sleep slot across every tribe's
 * `setatomic <job> 8 "..._sleep"` bindings, bound for every job, even babies (see source basis). The `sleep`
 * effect zeroes fatigue.
 */
export const SLEEP_ATOMIC_ID = 8;

/**
 * The atomic id a settler runs to pray — the original's `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY = 12`, bound
 * `setatomic 6 12 "..._pray"` for the civilist job across tribes (see source basis). The `pray` effect zeroes
 * piety.
 */
export const PRAY_ATOMIC_ID = 12;

/** The atomic id for a carrier picking goods up out of a store — the original's generic pickup=22 (like
 *  {@link PILEUP_ATOMIC_ID} the readable data binds no per-good pickup). */
export const PICKUP_ATOMIC_ID = 22;

/**
 * The atomic id a builder runs to raise a house — id 39 is the build-house slot bound for the builder job
 * across every tribe (source basis `DataCnmd/tribetypes12/tribetypes.ini`, and the builder's `allowatomic 39`
 * in `jobtypes.ini`; the viking binding's animation runs 15 ticks). The `construct` effect advances the site's
 * builder-work `labor`. A job is a builder iff it may run this atomic — the planner's data-driven "who
 * constructs" test, not a hardcoded jobType id. */
export const BUILD_HOUSE_ATOMIC_ID = 39;

/** The atomic id for depositing a carried load into a store. The readable data binds no per-good "pileup"
 *  atomic (harvest/produce are good-keyed; pickup=22/pileup are generic), so a constant keeps the planner
 *  data-driven where it matters (the harvest atomic is read from content) without inventing a per-good deposit
 *  binding the data lacks. */
export const PILEUP_ATOMIC_ID = 23;

/**
 * The atomic id a settler runs to set a carried load down before an interrupt takes over (a profession
 * change, or fleeing an enemy). The readable data binds no dedicated putdown clip (source basis: no `drop`
 * atomic in `atomicanimations`/`setatomic`), so the drop reuses the pickup gesture's animation — the same
 * bend-to-the-ground motion in reverse — as a named approximation; the typed `drop` effect
 * ({@link import('../../core/atomic-effect.js').AtomicEffect}) sets the whole load on the ground on completion,
 * so the behavior is the effect, not the shared id. */
export const DROP_ATOMIC_ID = PICKUP_ATOMIC_ID;

/**
 * Start a settler setting its carried load down (the {@link DROP_ATOMIC_ID} atomic, `drop` effect): it stops
 * where it is, plays the drop animation, then {@link import('./effects-goods/index.js').dropCarriedLoad} sets
 * the whole load on the ground on completion. Clearing the nav state ({@link clearNavState}) is what makes the
 * drop a standstill: a settler interrupted mid-walk (a porter re-ordered elsewhere, or scared into fleeing)
 * halts and sets the load down before moving, instead of dropping on the move. A busy settler is left alone —
 * the AI/combat gates already skip a unit with a {@link CurrentAtomic}, so the interrupting action
 * (re-employment, the parked walk, flee) only proceeds once the load is down. No-op on a settler already acting
 * (its atomic must not be clobbered) or one carrying nothing.
 */
export function startDrop(world: World, ctx: SystemContext, settler: Entity): void {
  if (world.has(settler, CurrentAtomic)) return; // already acting — don't clobber the running atomic
  const s = world.tryGet(settler, Settler);
  if (s === undefined || !world.has(settler, Carrying)) return; // nothing to set down
  clearNavState(world, settler); // stand still to drop — halt any walk in progress
  world.add(settler, CurrentAtomic, {
    atomicId: DROP_ATOMIC_ID,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: atomicDuration(ctx.content, s, DROP_ATOMIC_ID),
    effect: { kind: 'drop' },
    targetEntity: null,
    targetTile: null,
  });
}

/**
 * Start a {@link CurrentAtomic} on a settler: the executor (AtomicSystem) will advance it and apply
 * `effect` on completion. `duration` is the animation length in ticks (clamped to ≥1 by the
 * executor); `target` is the action's object (the resource/store), recorded for render/inspection.
 */
export function startAtomic(
  world: World,
  settler: Entity,
  atomicId: number,
  effect: AtomicEffect,
  duration: number,
  target: Entity,
): void {
  world.add(settler, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect,
    targetEntity: target,
    targetTile: null,
  });
}

/**
 * The step every target-bound drive ends in: standing on the target's interaction `cell`, run `start` (issue
 * the atomic); otherwise walk there (a {@link MoveGoal} the navigation planner turns into a route).
 */
export function atOrWalk(world: World, e: Entity, here: NodeId, cell: NodeId, start: () => void): void {
  if (cell === here) start();
  else world.add(e, MoveGoal, { cell });
}

/**
 * Issue the generic `pickup` atomic on `e` against the store/pile `from`: lift `amount` units of
 * `goodType` (the AtomicSystem's `pickup` caps the move at what the source actually holds). The
 * shared tail of every haul drive — trunk collection, porter ferrying, producer output/input runs
 * and the carrier fallback all lift goods the identical way.
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
  startAtomic(
    world,
    e,
    PICKUP_ATOMIC_ID,
    { kind: 'pickup', goodType, amount, from },
    atomicDuration(ctx.content, settler, PICKUP_ATOMIC_ID),
    from,
  );
}

/**
 * Issue the `draw` atomic on `e` against a shared utility (a well, a hive): the worker acts at the utility's
 * operate node for `ticks` — the utility recipe's own work time to extract one unit, not an animation length
 * — then {@link import('./effects-goods/index.js').drawUtilityGood} sets one unit of `goodType` on its back.
 * The gesture is the generic goods-handling animation ({@link PICKUP_ATOMIC_ID}, the same reuse
 * {@link DROP_ATOMIC_ID} makes): the drawer's trade is not the utility's and there is no decoded crank
 * animation, so a neutral bend-to-draw reads for any worker at either utility (named approximation).
 */
export function startDraw(world: World, e: Entity, goodType: number, utility: Entity, ticks: number): void {
  startAtomic(world, e, PICKUP_ATOMIC_ID, { kind: 'draw', goodType, utility }, ticks, utility);
}

/**
 * Walk to a store/pile's interaction cell and lift ONE unit of `goodType` from it — the shared tail of
 * every haul rung (trunk collection, porter ferrying, the carrier fallback). The batch is the global
 * {@link CARRY_CAPACITY} (a settler carries a single good unit; hauling more takes more trips).
 */
export function walkPickupBatch(plan: PlannerContext, from: Entity, goodType: number): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, from, here), () =>
    startPickup(world, ctx, e, plan, from, goodType, CARRY_CAPACITY),
  );
}
