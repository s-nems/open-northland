import { Building, Health, Marriage, Owner, Position, Settler, Wedding } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { type Fixed, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { unbindWorkersOf } from '../command/placement.js';
import type { System, SystemContext } from '../context.js';
import { scatterSpilledStock, spilledStockOf } from '../economy/goods-spill.js';
import { removeWorkFlag } from '../economy/work-flag.js';
import { isMinor } from '../family/households.js';
import { releaseWidowedParentsOf, settleWidowhood } from '../family/widowhood.js';
import { isAnimalTribe } from '../readviews/index.js';

/**
 * CleanupSystem (the death/cleanup half of the combat loop) - destroy every entity whose
 * {@link Health} pool has been drained to 0 and announce it with a `settlerDied` event. This is the
 * back half of "the targeting + death loop": the AtomicSystem's `attack` effect drains a target's
 * `hitpoints` (clamped at 0 - a hit never heals), and a pool reaching 0 means dead; this system is
 * what then *removes* the corpse and tells render/audio.
 *
 * It runs **last** in {@link SYSTEM_ORDER} so a hit landed earlier this tick (AtomicSystem) is reaped in the
 * same tick: nothing downstream observes a 0-HP zombie, and the entity is gone by the snapshot the renderer
 * reads. A 0-HP entity is destroyed outright - entity ids are monotonic and never recycled, so removing it can
 * never confuse a later id, and `world.destroy` drops every component the entity carried. The destroyed entity
 * is the one holding any cross-references (a worker's `JobAssignment` points settler→building, never
 * building→settler), so destroying it creates no dangling reference the way destroying a *building* out from
 * under a bound worker would (that hazard is the reverse direction, handled at the `demolish` seam).
 *
 * Source basis: "a combatant at 0 hitpoints is dead and removed" is the faithful baseline. The hitpoint pool it
 * drains and who deals the damage are the approximated halves (no oracle - humans' hitpoints are below the
 * readable `.ini`); this system only reaps a pool another mechanic emptied. The `cause` string is a render/audio
 * hint, not simulated state - combat damage vs starvation, told apart by {@link causeOf}'s heuristic.
 *
 * Determinism: the dead set is gathered by scanning the {@link Health} store, then collected into a canonical
 * (ascending-id) list before any destroy - mutating the store mid-`query` is a footgun, and a canonical destroy
 * order makes the emitted `settlerDied` events a reproducible function of state (render reads their order, so it
 * must be stable). Every settler carries `Health` (civilians included), so this scan visits all settlers each
 * tick - one linear pass with an O(1) check per entry, nothing destroyed until some mechanic empties a pool.
 */
export const cleanupSystem: System = (world, ctx) => {
  // Collect-then-destroy: never `world.destroy` while iterating the store the scan reads. Canonical
  // (ascending-id) order so the `settlerDied` events render consumes are stable.
  const dead: Entity[] = [];
  for (const e of world.query(Health)) {
    if (world.get(e, Health).hitpoints <= 0) dead.push(e);
  }
  dead.sort((a, b) => a - b);
  for (const e of dead) {
    // A drained building is razed through the demolish path (release its workers), not the settler-death
    // path - it has no marriage/flag/starvation state and must not fire a `settlerDied` stinger.
    if (world.has(e, Building)) razeBuilding(world, ctx, e);
    else reap(world, ctx, e);
  }
};

/**
 * Raze a building - the ONE teardown seam combat razing (a Health pool drained to 0) and the player's
 * `demolish` command share: release every settler bound to it ({@link unbindWorkersOf}, so a besieged
 * workplace doesn't strand its operators on a dead entity), announce it (`buildingDestroyed` - the
 * render/audio collapse cue, carrying the type and build progress so an unfinished site collapses as
 * scaffolding), remove it, and heap whatever was inside on the ground where it stood
 * ({@link scatterSpilledStock}). The event is emitted before the destroy so the entity's
 * `Owner`/`Position`/`Building` are still readable.
 */
export function razeBuilding(world: World, ctx: SystemContext, e: Entity): void {
  const owner = world.tryGet(e, Owner);
  const pos = world.tryGet(e, Position);
  const building = world.get(e, Building);
  ctx.events.emit({
    kind: 'buildingDestroyed',
    entity: e,
    player: owner?.player ?? null,
    buildingType: building.buildingType,
    built: building.built,
    ...(pos !== undefined ? { at: eventAt(pos.x, pos.y) } : {}),
  });
  unbindWorkersOf(world, ctx, e);
  const spill = spilledStockOf(world, e);
  world.destroy(e);
  scatterSpilledStock(world, ctx, spill);
}

/** Announce a combatant's death (`settlerDied`, the render/audio cue) and remove it from the world. The event
 *  is emitted before the destroy so the entity id it carries is still that of a (just-)alive entity, and so its
 *  `Owner`/`Position` are still readable: `player` (owner slot, `null` when unowned) lets audio play the death
 *  stinger for the local player only, and `at` (the death node) lets render leave a bones marker where it fell
 *  (humans only, which is what the `animal` flag tells apart - see the event's doc). */
function reap(world: World, ctx: SystemContext, e: Entity): void {
  const owner = world.tryGet(e, Owner);
  const pos = world.tryGet(e, Position);
  const settler = world.tryGet(e, Settler);
  const animal = settler !== undefined && isAnimalTribe(ctx.content, settler.tribe);
  ctx.events.emit({
    kind: 'settlerDied',
    entity: e,
    cause: causeOf(settler),
    player: owner?.player ?? null,
    ...(animal ? { animal: true } : {}),
    ...(pos !== undefined ? { at: eventAt(pos.x, pos.y) } : {}),
  });
  removeWorkFlag(world, e); // a flag-bound gatherer's flag has no owner once it's gone - reap it too
  const marriage = world.tryGet(e, Marriage);
  const wedding = world.tryGet(e, Wedding);
  const wasMinor = isMinor(world, e);
  world.destroy(e);
  // The widowing rule (`family/widowhood.ts`) needs the decedent already dead, so the destroy runs
  // first. A dying MINOR is the other expiry trigger: its widowed parent's carve-out ends with it.
  if (marriage !== undefined && world.isAlive(marriage.spouse)) settleWidowhood(world, marriage.spouse);
  if (wedding !== undefined && world.isAlive(wedding.partner)) world.remove(wedding.partner, Wedding);
  if (wasMinor) releaseWidowedParentsOf(world, e);
}

/** A render/audio hint, not simulated state: which lethal path most plausibly emptied the pool. A settler
 *  reaped with its hunger pinned at ONE reads as starved (the NeedsSystem's starvation bite is the only drain
 *  that requires that state) - a heuristic, since a swing can also land on a starving settler; the ambiguity is
 *  acceptable for a cue. Everything else is combat/attack damage. */
function causeOf(settler: { hunger: Fixed } | undefined): string {
  return settler !== undefined && settler.hunger === ONE ? DEATH_CAUSE_STARVATION : DEATH_CAUSE_DAMAGE;
}

/** A combatant drained to 0 hitpoints by completed `attack`s. */
const DEATH_CAUSE_DAMAGE = 'damage';
/** A settler starved to death - its hunger pinned at ONE while the NeedsSystem bit its pool empty. */
const DEATH_CAUSE_STARVATION = 'starvation';
