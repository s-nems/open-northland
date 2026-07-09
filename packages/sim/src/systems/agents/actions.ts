import { CurrentAtomic, MoveGoal } from '../../components/index.js';
import type { AtomicEffect } from '../../core/commands.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { atomicDuration } from '../readviews/animations.js';

// The planner's ACTION vocabulary: the atomic ids the drives issue, the shared "start an atomic"
// entry point, and the walk-or-act step every target-bound drive ends in. Split out of ai.ts so a
// drive module states WHAT a settler does next while this module owns HOW an action is issued.

/**
 * The numeric atomic id a settler runs to eat (the original's `setatomic <job> 10 "..._eat_slot_food"`
 * — id 10 is the eat slot across every tribe's bindings; see source basis). Like the other ids
 * it is the content cross-reference / animation join key; the typed `eat` effect is the behavior
 * (consume one unit of food + reset hunger, AtomicSystem).
 */
export const EAT_ATOMIC_ID = 10;

/**
 * The numeric atomic id a settler runs to sleep (the original's `setatomic <job> 8 "..._sleep"` — id
 * 8 is the sleep slot across every tribe's bindings, bound for every job, even babies; see
 * source basis). Like the other ids it is the content cross-reference / animation join key; the
 * typed `sleep` effect is the behavior (zero fatigue, AtomicSystem).
 */
export const SLEEP_ATOMIC_ID = 8;

/**
 * The numeric atomic id a settler runs to pray (the original's `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY
 * = 12`, bound `setatomic 6 12 "..._pray"` for the civilist job across tribes; see source basis).
 * Like the other ids it is the content cross-reference / animation join key; the typed `pray` effect
 * is the behavior (zero piety, AtomicSystem).
 */
export const PRAY_ATOMIC_ID = 12;

/** The numeric atomic id for a carrier picking goods up out of a store (the original's generic
 *  pickup=22; like {@link PILEUP_ATOMIC_ID} the readable data binds no per-good pickup, and the id is
 *  only a content cross-reference / animation join key — the typed `pickup` effect is the behavior). */
export const PICKUP_ATOMIC_ID = 22;

/** The numeric atomic id used for depositing a carried load into a store. The READABLE data binds
 *  no per-good "pileup" atomic (harvest/produce are good-keyed; pickup=22/pileup are generic), and
 *  the id is only a content cross-reference / animation join key — the *effect* (typed `pileup`) is
 *  what the AtomicSystem applies. A constant keeps the planner data-driven where it matters (the
 *  harvest atomic IS read from content) without inventing a per-good deposit binding the data lacks. */
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
 * The step every target-bound drive ends in: standing on the target's interaction `cell`, run
 * `start` (issue the atomic); otherwise walk there (a {@link MoveGoal} the navigation planner turns
 * into a route). One helper for the nine walk-or-act sites the drives used to spell out by hand.
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
