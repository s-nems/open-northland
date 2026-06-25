import { Health } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import type { System, SystemContext } from './context.js';

/**
 * CleanupSystem (the death/cleanup half of the combat loop) — destroy every entity whose
 * {@link Health} pool has been drained to 0 and announce it with a `settlerDied` event. This is the
 * back half of "the targeting + death loop": the AtomicSystem's `attack` effect drains a target's
 * `hitpoints` (clamped at 0 — a hit never heals), and a pool reaching 0 means dead; this system is
 * what then *removes* the corpse and tells render/audio.
 *
 * It runs **last** in {@link SYSTEM_ORDER} so a hit landed earlier this tick (AtomicSystem) is reaped
 * in the same tick: nothing downstream observes a 0-HP zombie, and the entity is gone by the snapshot
 * the renderer reads. A 0-HP entity is destroyed outright — entity ids are MONOTONIC and never
 * recycled (`World`), so removing it can never confuse a later id, and `world.destroy` drops every
 * component the entity carried (its own `Settler`/`Position`/`JobAssignment`/… vanish with it). The
 * destroyed entity is the one holding any cross-references (a worker's `JobAssignment` points
 * settler→building, never building→settler), so destroying it creates no dangling reference the way
 * destroying a *building* out from under a bound worker would (see LESSONS [71f13ab] — that hazard is
 * the reverse direction, handled at the `demolish` seam).
 *
 * FIDELITY: "a combatant at 0 hitpoints is dead and removed" is the faithful baseline (a felled
 * settler/animal leaves the field). The *hitpoint pool* it drains and *who deals the damage* are the
 * approximated halves (no oracle — humans' hitpoints are below the readable `.ini`; the targeting
 * drive is a later slice); this system only reaps a pool another mechanic emptied. The `cause` string
 * is a render/audio hint, not simulated state — it is the same for every death for now (`'damage'`),
 * since the only thing that drains `Health` is a completed `attack`.
 *
 * Determinism: the dead set is gathered by scanning the {@link Health} store, then COLLECTED into a
 * canonical (ascending-id) list BEFORE any destroy — mutating the store mid-`query` is a footgun
 * (LESSONS [71f13ab]), and a canonical destroy order makes the emitted `settlerDied` events a pure,
 * reproducible function of state (the event order is hashed into nothing, but render reads it, so it
 * must be stable). No RNG, no wall-clock. Inert on the goldens/slice: they construct no `Health`-
 * bearing entity (combat is unreached there), so no entity is ever destroyed and the hash is
 * untouched — the [6264132] "only fires on a state the goldens never construct" pattern.
 */
export const cleanupSystem: System = (world, ctx) => {
  // Collect-then-destroy: never `world.destroy` while iterating the store the scan reads (LESSONS
  // [71f13ab]). Canonical (ascending-id) order so the `settlerDied` events render consumes are stable.
  const dead: Entity[] = [];
  for (const e of world.query(Health)) {
    if (world.get(e, Health).hitpoints <= 0) dead.push(e);
  }
  dead.sort((a, b) => a - b);
  for (const e of dead) reap(world, ctx, e);
};

/** Announce a combatant's death (`settlerDied`, the render/audio cue) and remove it from the world.
 *  The event is emitted BEFORE the destroy so the entity id it carries is still that of a (just-)alive
 *  entity at emit time; render only reads the id, never the live components. */
function reap(world: World, ctx: SystemContext, e: Entity): void {
  ctx.events.emit({ kind: 'settlerDied', entity: e, cause: DEATH_CAUSE_DAMAGE });
  world.destroy(e);
}

/** The only death cause today: a combatant drained to 0 hitpoints by a completed `attack`. A render/
 *  audio hint, not simulated state — when other lethal paths exist (starvation, decay) they pass their
 *  own cause string. */
const DEATH_CAUSE_DAMAGE = 'damage';
