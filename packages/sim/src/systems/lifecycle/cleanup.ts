import {
  Female,
  Health,
  Marriage,
  Owner,
  Position,
  Residence,
  Settler,
  Wedding,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { removeWorkFlag } from '../economy/flags.js';
import { isMinor } from '../family/households.js';

/**
 * CleanupSystem (the death/cleanup half of the combat loop) — destroy every entity whose
 * {@link Health} pool has been drained to 0 and announce it with a `settlerDied` event. This is the
 * back half of "the targeting + death loop": the AtomicSystem's `attack` effect drains a target's
 * `hitpoints` (clamped at 0 — a hit never heals), and a pool reaching 0 means dead; this system is
 * what then *removes* the corpse and tells render/audio.
 *
 * It runs **last** in {@link SYSTEM_ORDER} so a hit landed earlier this tick (AtomicSystem) is reaped in the
 * same tick: nothing downstream observes a 0-HP zombie, and the entity is gone by the snapshot the renderer
 * reads. A 0-HP entity is destroyed outright — entity ids are monotonic and never recycled, so removing it can
 * never confuse a later id, and `world.destroy` drops every component the entity carried. The destroyed entity
 * is the one holding any cross-references (a worker's `JobAssignment` points settler→building, never
 * building→settler), so destroying it creates no dangling reference the way destroying a *building* out from
 * under a bound worker would (that hazard is the reverse direction, handled at the `demolish` seam).
 *
 * Source basis: "a combatant at 0 hitpoints is dead and removed" is the faithful baseline. The hitpoint pool it
 * drains and who deals the damage are the approximated halves (no oracle — humans' hitpoints are below the
 * readable `.ini`); this system only reaps a pool another mechanic emptied. The `cause` string is a render/audio
 * hint, not simulated state — combat damage vs starvation, told apart by {@link causeOf}'s heuristic.
 *
 * Determinism: the dead set is gathered by scanning the {@link Health} store, then collected into a canonical
 * (ascending-id) list before any destroy — mutating the store mid-`query` is a footgun, and a canonical destroy
 * order makes the emitted `settlerDied` events a reproducible function of state (render reads their order, so it
 * must be stable). Every settler carries `Health` (civilians included), so this scan visits all settlers each
 * tick — one linear pass with an O(1) check per entry, nothing destroyed until some mechanic empties a pool.
 */
export const cleanupSystem: System = (world, ctx) => {
  // Collect-then-destroy: never `world.destroy` while iterating the store the scan reads. Canonical
  // (ascending-id) order so the `settlerDied` events render consumes are stable.
  const dead: Entity[] = [];
  for (const e of world.query(Health)) {
    if (world.get(e, Health).hitpoints <= 0) dead.push(e);
  }
  dead.sort((a, b) => a - b);
  for (const e of dead) reap(world, ctx, e);
};

/** Announce a combatant's death (`settlerDied`, the render/audio cue) and remove it from the world. The event
 *  is emitted before the destroy so the entity id it carries is still that of a (just-)alive entity, and so its
 *  `Owner`/`Position` are still readable: `player` (owner slot, `null` when unowned) lets audio play the death
 *  stinger for the local player only, and `at` (the death node) lets render leave a cadaver/bones marker where
 *  it fell. */
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
  // Death dissolves the union: the surviving spouse is widowed (free to remarry — "for life" ends at a
  // death), and a partner mid-wedding is released from the ceremony. The exception is a widowed parent
  // whose child still grows: its Marriage is the only carrier of the parent-child edge (familyOf/assignHouse
  // move the child with the survivor, the child's surname resolves through it), so it stays until the
  // child grows up — `mayMarry` treats a dead-spouse marriage with no growing child as dissolved, and
  // the next wedding simply overwrites the stale component.
  const marriage = world.tryGet(e, Marriage);
  if (marriage !== undefined && world.isAlive(marriage.spouse)) {
    const spouse = marriage.spouse;
    const child = marriage.child;
    const raising = child !== null && world.isAlive(child) && isMinor(world, child);
    if (!raising) {
      world.remove(spouse, Marriage);
      // A widower left with no growing child also vacates his home so a fresh family can move in:
      // homes anchor on women (the AI refills a free family slot with a married woman), and the man
      // rejoins the marriage pool to be housed into a wife's home. A widow keeps her home and refills
      // it by remarrying, so only a male survivor is evicted (user-specified design, 2026-07-18).
      if (!world.has(spouse, Female)) world.remove(spouse, Residence);
    }
  }
  const wedding = world.tryGet(e, Wedding);
  if (wedding !== undefined && world.isAlive(wedding.partner)) world.remove(wedding.partner, Wedding);
  world.destroy(e);
}

/** A render/audio hint, not simulated state: which lethal path most plausibly emptied the pool. A settler
 *  reaped with its hunger pinned at ONE reads as starved (the NeedsSystem's starvation bite is the only drain
 *  that requires that state) — a heuristic, since a swing can also land on a starving settler; the ambiguity is
 *  acceptable for a cue. Everything else is combat/attack damage. */
function causeOf(world: World, e: Entity): string {
  const settler = world.has(e, Settler) ? world.get(e, Settler) : undefined;
  return settler !== undefined && settler.hunger === ONE ? DEATH_CAUSE_STARVATION : DEATH_CAUSE_DAMAGE;
}

/** A combatant drained to 0 hitpoints by completed `attack`s. */
const DEATH_CAUSE_DAMAGE = 'damage';
/** A settler starved to death — its hunger pinned at ONE while the NeedsSystem bit its pool empty. */
const DEATH_CAUSE_STARVATION = 'starvation';
