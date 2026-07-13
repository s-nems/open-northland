import { CurrentAtomic, Settler } from '../../../../components/index.js';
import { fx } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { atomicAnimationName, atomicDuration } from '../../../readviews/animations.js';
import { isInterruptibleAtomic } from '../../../readviews/index.js';

/**
 * The numeric atomic id a struck combatant runs to **flinch** — the original's `setatomic <job> 82
 * "..._attacked"` slot (id 82 = the ATTACKED/stagger slot). Among the **playable** civilizations only
 * the civilian classes bind it (`viking_woman_attacked` / `viking_civilist_attacked`, length 50, no
 * events — playable soldiers/heroes have no 82 row); the **monster tribes** (weresnake/werewolf/
 * bear-weresnake) also bind it for their creature-soldier classes (`DataCnmd/tribetypes12/tribetypes.ini`),
 * so a struck were-monster flinches too — the data-driven design working, not a special case. Purely
 * visual: the atomic carries an `idle` effect (no state mutation), it just occupies the victim so a
 * struck combatant visibly staggers and can't act for its duration. A class with no 82 binding (a
 * playable soldier) never staggers, with zero per-job code.
 */
const ATTACKED_ATOMIC_ID = 82;

/** One deferred stagger: give `victim` the ATTACKED (`82`) flinch atomic for `duration` ticks. Collected
 *  at HIT time ({@link collectStagger}), applied only AFTER the hit loop ({@link applyPendingStaggers}) —
 *  the shared shape both the melee (`atomicSystem`) and ranged (`projectileSystem`) hit passes use. */
export interface PendingStagger {
  readonly victim: Entity;
  readonly duration: number;
}

/**
 * Apply a hit pass's collected {@link PendingStagger}s — give each struck survivor its ATTACKED (`82`)
 * flinch atomic. **Deferred** past the pass's own loop on purpose: adding a `CurrentAtomic` to the store
 * the melee pass is iterating would let a victim visited later advance its own fresh stagger this same
 * tick (Map iteration visits a key inserted during iteration), an order-coupling; deferring makes the
 * flinch provably begin advancing the NEXT tick, independent of iteration order. `world.add` overwrites
 * any interruptible action the victim was still running (it was vetted interruptible at hit time — a blow
 * knocks it off task). Two hits on one victim this tick push the same idempotent flinch; last-wins is
 * harmless (identical atomic). Called by `atomicSystem` (melee) and the projectileSystem (ranged).
 */
export function applyPendingStaggers(world: World, pendingStaggers: readonly PendingStagger[]): void {
  for (const { victim, duration } of pendingStaggers) {
    world.add(victim, CurrentAtomic, {
      atomicId: ATTACKED_ATOMIC_ID,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
  }
}

/**
 * Decide — at HIT time — whether a struck **survivor** flinches, and if so COLLECT it for the deferred
 * `world.add` the executor does after its loop (see `atomicSystem`). The flinch is the original's
 * `setatomic <job> 82 "..._attacked"` ATTACKED atomic ({@link ATTACKED_ATOMIC_ID}) — a `CurrentAtomic`
 * carrying an **`idle`** effect (no state mutation) for the ATTACKED animation's length, purely visual
 * occupancy (the struck victim visibly staggers and can't act for its duration, then frees up).
 *
 * **Purely data-driven — no per-job code:** a class flinches iff its `(tribe, job)` binds atomic 82.
 * Among the *playable* civilizations only the civilian classes do (woman/civilist); the monster tribes
 * (weresnake/werewolf/bear-weresnake) also bind it for their creature-soldier classes, which therefore
 * stagger too — that is the design working, not a special case. A class with no 82 binding (a playable
 * soldier/hero) never flinches.
 *
 * Only flags an **interruptible** current action (checked HERE, at the hit, not at the deferred add):
 * a victim mid-swing or already mid-flinch (both `interruptable 0` in the data) is NOT re-staggered —
 * no stunlock, and its own uninterruptible action plays out. An idle victim (no `CurrentAtomic`) always
 * flinches. The deferred add then overwrites whatever interruptible action remains (a blow knocks the
 * victim off task).
 */
export function collectStagger(
  world: World,
  ctx: SystemContext,
  target: Entity,
  pendingStaggers: PendingStagger[],
): void {
  const victim = world.tryGet(target, Settler);
  if (victim === undefined) return; // not a settler/animal — nothing to stagger
  const staggerAnim = atomicAnimationName(ctx.content, victim, ATTACKED_ATOMIC_ID);
  if (staggerAnim === undefined) return; // this class has no `82` binding — it doesn't flinch (data-driven)
  // Don't cut short an uninterruptible action (the victim's own attack swing, or an in-progress flinch).
  const current = world.tryGet(target, CurrentAtomic);
  if (current !== undefined) {
    const currentAnim = atomicAnimationName(ctx.content, victim, current.atomicId);
    // An unresolved current animation is treated as non-interruptible (the `isInterruptibleAtomic`
    // safe default) — don't preempt an action with no timing record.
    if (currentAnim === undefined || !isInterruptibleAtomic(ctx.content, currentAnim)) return;
  }
  pendingStaggers.push({ victim: target, duration: atomicDuration(ctx.content, victim, ATTACKED_ATOMIC_ID) });
}
