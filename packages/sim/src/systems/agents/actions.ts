import { CurrentAtomic, MoveGoal } from '../../components/index.js';
import type { AtomicEffect } from '../../core/atomic-effect.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { carrierCarryCapacity } from '../progression/index.js';
import { atomicDuration } from '../readviews/animations.js';
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
export function eatDuration(ctx: SystemContext, settler: { tribe: number; jobType: number | null }): number {
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
  settler: { tribe: number; jobType: number | null },
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
 * Walk to a store/pile's interaction cell and lift a full carrier batch of `goodType` from it — the shared
 * tail of every haul rung (trunk collection, porter ferrying, the carrier fallback). The batch is the tribe's
 * carry capacity (one unit on foot, a vehicle's `stockSlots` when unlocked), capped by `pickupFromStore` to
 * what the source actually holds.
 */
export function walkPickupBatch(plan: PlannerContext, from: Entity, goodType: number): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, from, here), () =>
    startPickup(world, ctx, e, plan, from, goodType, carrierCarryCapacity(world, ctx, plan.tribe)),
  );
}
