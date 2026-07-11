import { Health, Owner, Position, Settler } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { removeWorkFlag } from '../economy/flags.js';

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
 * destroying a *building* out from under a bound worker would (see AGENTS [71f13ab] — that hazard is
 * the reverse direction, handled at the `demolish` seam).
 *
 * source-basis: "a combatant at 0 hitpoints is dead and removed" is the faithful baseline (a felled
 * settler/animal leaves the field). The *hitpoint pool* it drains and *who deals the damage* are the
 * approximated halves (no oracle — humans' hitpoints are below the readable `.ini`); this system only
 * reaps a pool another mechanic emptied. The `cause` string is a render/audio hint, not simulated
 * state — combat damage vs starvation, told apart by {@link causeOf}'s heuristic.
 *
 * Determinism: the dead set is gathered by scanning the {@link Health} store, then COLLECTED into a
 * canonical (ascending-id) list BEFORE any destroy — mutating the store mid-`query` is a footgun
 * (AGENTS [71f13ab]), and a canonical destroy order makes the emitted `settlerDied` events a pure,
 * reproducible function of state (the event order is hashed into nothing, but render reads it, so it
 * must be stable). No RNG, no wall-clock. Since 2026-07-11 EVERY settler carries `Health` (civilians
 * included), so this scan visits all settlers each tick — still one linear pass over the Health store
 * with an O(1) check per entry, and nothing is destroyed until some mechanic (a swing, starvation)
 * actually empties a pool.
 */
export const cleanupSystem: System = (world, ctx) => {
  // Collect-then-destroy: never `world.destroy` while iterating the store the scan reads (AGENTS
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
 *  entity at emit time — and so its `Owner`/`Position` are still readable: `player` (owner slot, `null`
 *  when unowned) lets audio play the death stinger for the local player only, and `at` (the death node)
 *  lets render leave a cadaver/bones marker where it fell. Render otherwise only reads the id, never the
 *  live components. */
function reap(world: World, ctx: SystemContext, e: Entity): void {
  const owner = world.tryGet(e, Owner);
  const pos = world.tryGet(e, Position);
  ctx.events.emit({
    kind: 'settlerDied',
    entity: e,
    cause: causeOf(world, e),
    player: owner?.player ?? null,
    ...(pos !== undefined ? { at: eventAt(pos.x, pos.y) } : {}),
  });
  removeWorkFlag(world, e); // a flag-bound gatherer's flag has no owner once it's gone — reap it too
  world.destroy(e);
}

/** A render/audio hint, not simulated state: which lethal path most plausibly emptied the pool. A
 *  settler reaped with its hunger PINNED at ONE reads as starved (the NeedsSystem's starvation bite is
 *  the only drain that requires that state) — a heuristic, since a swing can also land on a starving
 *  settler; the ambiguity is acceptable for a cue. Everything else is combat/attack damage. */
function causeOf(world: World, e: Entity): string {
  const settler = world.has(e, Settler) ? world.get(e, Settler) : undefined;
  return settler !== undefined && settler.hunger === ONE ? DEATH_CAUSE_STARVATION : DEATH_CAUSE_DAMAGE;
}

/** A combatant drained to 0 hitpoints by completed `attack`s. */
const DEATH_CAUSE_DAMAGE = 'damage';
/** A settler starved to death — its hunger pinned at ONE while the NeedsSystem bit its pool empty. */
const DEATH_CAUSE_STARVATION = 'starvation';
