import { assertNever } from '../brand.js';
import type { AtomicEffect } from '../commands.js';
import { Anger, Carrying, CurrentAtomic, Health, Resource, Settler, Stockpile } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { fx } from '../fixed.js';
import type { System, SystemContext } from './context.js';
import { grantWorkExperience } from './progression.js';
import { angryGameTimeOf, isAggressiveAnimal, isProvokableAnimal } from './readviews/index.js';
import { stockCapacity } from './shared.js';

/**
 * AtomicSystem — the executor half of the settler planner: advance the {@link CurrentAtomic} a
 * settler is running and, on completion, apply its typed {@link AtomicEffect}.
 *
 * Each tick, for every entity with a CurrentAtomic, the integer `elapsed` counter advances; a
 * `duration` of D ticks completes on the D-th tick (a 0/1-tick animation completes the first tick —
 * `duration` is clamped to at least 1). Timing is the exact integer compare `elapsed >= duration`,
 * NOT an accumulated fixed-point step: `ONE / duration` truncates, so summing it `duration` times
 * would fall short of ONE and the atomic would hang. `progress` (0..ONE) is recomputed each tick as
 * a derived display value for render interpolation only. When the atomic completes the executor
 * applies the effect (the state mutation), emits an `atomicCompleted` event for render/audio, and
 * removes the component — the planner reads an entity with no CurrentAtomic as ready for its next.
 *
 * `applyEffect` is an exhaustive switch over the {@link AtomicEffect} union (`assertNever` makes a
 * new variant a compile error here), so behavior is the typed effect, not an opaque atomicId. The
 * harvest→pickup→carry→pileup chain that the single-settler slice needs is implemented; `attack`
 * resolves a hit (drains the target's {@link Health}, the first combat behavior); `produce` belongs
 * to ProductionSystem and only signals completion here for now.
 *
 * Determinism: no RNG, no wall-clock. Entities are visited in the CurrentAtomic store's deterministic
 * insertion order, and each effect is a pure function of the entity + its target's current state
 * (Stockpile writes go through the canonical Map, never iterated for a decision). Fixed-point only.
 */
export const atomicSystem: System = (world, ctx) => {
  for (const e of world.query(CurrentAtomic)) {
    const atomic = world.get(e, CurrentAtomic);
    const duration = Math.max(1, atomic.duration);
    atomic.elapsed += 1;
    // Derived 0..ONE display value (render interpolation); clamped so it never exceeds ONE.
    atomic.progress = fx.div(fx.fromInt(Math.min(atomic.elapsed, duration)), fx.fromInt(duration));
    if (atomic.elapsed < duration) continue; // still running

    // Completed this tick: apply the effect, notify render/audio, and free the settler.
    applyEffect(world, ctx, e, atomic.effect);
    ctx.events.emit({ kind: 'atomicCompleted', entity: e, atomicId: atomic.atomicId });
    world.remove(e, CurrentAtomic);
  }
};

/**
 * Apply a completed atomic's effect. Exhaustive over {@link AtomicEffect}: adding a variant is a
 * compile error until it is handled here (`assertNever`). Each branch is a pure function of current
 * state — no RNG, no wall-clock.
 */
function applyEffect(world: World, ctx: SystemContext, settler: Entity, effect: AtomicEffect): void {
  switch (effect.kind) {
    case 'harvest':
      // The settler gathers HARVEST_YIELD unit(s) of the resource's good onto its back (carriers
      // haul; goods never teleport) AND the harvested node loses that many units. The yield and the
      // depletion use the same constant so a node releases exactly what settlers carry away — goods
      // are conserved and a finite node empties (planner's `remaining <= 0` gate then skips it).
      harvestFromNode(world, settler, effect.resource, effect.goodType);
      // Completing a work atomic that yields a good trains the settler's `(job, good)` specialization
      // — the original grants XP within a narrow `(job, good)` track, not just per job (see
      // ProgressionSystem). No-op when the job/good pairing has no track.
      grantWorkExperience(world, ctx, settler, effect.goodType);
      return;
    case 'pickup':
      pickupFromStore(world, settler, effect.from, effect.goodType, effect.amount);
      return;
    case 'pileup':
      pileupIntoStore(world, ctx, settler, effect.store);
      return;
    case 'eat':
      // Eating consumes one unit of food (from a store the eater stands on, or its own carried load)
      // and clears hunger. Goods are conserved up to that consumption — the food is destroyed, never
      // conjured: if the source has nothing left (it emptied between the planner choosing it and the
      // swing completing) no unit is removed, but hunger still resets (the bite was taken).
      consumeFood(world, settler, effect.from, effect.goodType);
      if (world.has(settler, Settler)) world.get(settler, Settler).hunger = fx.fromInt(0);
      return;
    case 'sleep':
      // Resting clears fatigue (no goods consumed — sleeping is free, unlike eating). Pairs with the
      // NeedsSystem's per-tick fatigue rise to close the rise→sleep→reset loop.
      if (world.has(settler, Settler)) world.get(settler, Settler).fatigue = fx.fromInt(0);
      return;
    case 'pray':
      // Praying clears piety (no goods consumed — like sleeping, devotion is free). Pairs with the
      // NeedsSystem's per-tick piety rise to close the rise→pray→reset loop. The walk to a temple is
      // the planner's job (a target-bound need); by the time this fires the settler is standing on one.
      if (world.has(settler, Settler)) world.get(settler, Settler).piety = fx.fromInt(0);
      return;
    case 'enjoy':
      // Recreation clears enjoyment (no goods consumed — like sleeping/praying, leisure is free).
      // Pairs with the NeedsSystem's per-tick enjoyment rise to close the rise→enjoy→reset loop. The
      // satisfier *drive* (where this is run) is deferred — `enjoy` has no readable building satisfier
      // (see docs/FIDELITY.md) — so no planner branch chooses it yet; the reset is wired and ready.
      if (world.has(settler, Settler)) world.get(settler, Settler).enjoyment = fx.fromInt(0);
      return;
    case 'make_love':
      // Making love also clears enjoyment (no goods consumed — like enjoy). The make_love atomic
      // (id 78) is not a separate need: its animation restores the SAME channel 3 as `enjoy`
      // (`event <at> 3 +800` tuples), the leisure bar — so it resets `enjoyment` too. The drive is
      // deferred for the same reason as `enjoy` (no readable building satisfier — see docs/FIDELITY.md);
      // no planner branch chooses it yet, the reset is wired and ready.
      if (world.has(settler, Settler)) world.get(settler, Settler).enjoyment = fx.fromInt(0);
      return;
    case 'move':
    case 'idle':
      // Pure markers: the actual walking is the navigation layer (PathFollow/MovementSystem). The
      // atomic just completing is the signal; no extra state change.
      return;
    case 'attack':
      // The hit-resolution step — the first real combat behavior. The effect carries the already
      // RESOLVED net damage (the planner looked it up from `combatDamage`: the attacker's weapon ×
      // the target's armor class), so the executor just drains the target's hitpoints, exactly as
      // `pickup`/`eat` apply a pre-resolved amount. Targeting/who-attacks-whom and the death/cleanup
      // loop are later slices; this is the hit landing. The blow ALSO provokes an otherwise-passive
      // `getAngry` animal into temporary hostility (the `animaltypes.ini` provoked-anger half).
      resolveHit(world, ctx, effect.target, effect.damage);
      return;
    case 'produce':
      // Owned by ProductionSystem (a later slice). Completing the atomic + emitting the event is
      // enough for now; the heavy mutation lands when that system exists.
      return;
    default:
      assertNever(effect); // a new AtomicEffect variant is a compile error until handled above
  }
}

/**
 * Units a single completed `harvest` atomic yields — granted to the settler AND removed from the
 * harvested node. One unit per swing keeps the node draining in step with what gets carried away,
 * so goods are conserved (a node of N units survives exactly N harvests). A real per-good yield
 * (some nodes drop more per swing) is a later balance slice — kept a constant so tuning is a diff.
 */
const HARVEST_YIELD = 1;

/**
 * Resolve one completed harvest: grant {@link HARVEST_YIELD} of `goodType` onto the settler's back
 * and deplete the harvested node by the same amount (clamped at 0). The node may already be gone
 * (destroyed/consumed between the atomic starting and completing) — a missing {@link Resource} just
 * skips the decrement; the carry still happens (the swing was made). `remaining` reaching 0 is the
 * planner's "nothing left here" gate, so the node is left in place (a later slice may clean it up).
 */
function harvestFromNode(world: World, settler: Entity, node: Entity, goodType: number): void {
  addCarry(world, settler, goodType, HARVEST_YIELD);
  const res = world.tryGet(node, Resource);
  if (res === undefined) return; // node already gone — nothing to deplete
  res.remaining = Math.max(0, res.remaining - HARVEST_YIELD);
}

/**
 * Resolve one completed `attack`: drain `damage` net hitpoints from the target's {@link Health},
 * clamped at 0 (a hit never *heals* — armor can fully absorb a blow but the pool never goes negative,
 * the same clamp `combatDamage` applies to net damage). `damage` is the pre-resolved net value the
 * planner looked up from `combatDamage` (the attacker's weapon × the target's armor class), so the
 * executor needs no content/weapon lookup. A `target` with no `Health` is a no-op — it was already
 * destroyed between the swing starting and landing, or is a non-combatant (the swing struck air);
 * never throw, mirroring how `harvest`/`pickup` tolerate a vanished resource/store. Reaching 0
 * hitpoints is "dead"; the death/cleanup loop (removing the entity, emitting `settlerDied`) is a
 * later slice — for now a 0-HP target simply stops being viable.
 *
 * The hit ALSO **provokes** an otherwise-passive `getAngry` animal: if the struck target is a
 * {@link isProvokableAnimal} animal (an `animaltypes.ini` record with `getangry`, e.g. a boar/deer),
 * an {@link Anger} timer is stamped/refreshed on it (`until = tick + angryGameTime`) — the
 * `combatSystem` then treats it like an aggressive animal until the timer lapses, so a struck animal
 * defends itself. An always-`aggressive` animal needs no provocation (it is already hostile), so we
 * only stamp anger on a provokable one; this is the provoked-anger half of `animaltypes.ini`
 * aggression (docs/FIDELITY.md "Civ-vs-animal aggression").
 */
function resolveHit(world: World, ctx: SystemContext, target: Entity, damage: number): void {
  const health = world.tryGet(target, Health);
  if (health === undefined) return; // target gone / non-combatant — the swing struck nothing
  // `combatDamage` already clamps net damage at 0, so a well-formed effect carries `damage >= 0`; the
  // inner `Math.max(0, damage)` is the defensive guard against a malformed (negative) effect *healing*
  // the target — silently corrupting hitpoints is the worse failure, so floor it rather than trust the
  // caller. The outer `Math.max(0, …)` floors the pool itself (a hit never drives it below 0).
  health.hitpoints = Math.max(0, health.hitpoints - Math.max(0, damage));
  provokeAnger(world, ctx, target);
}

/**
 * Provoke a struck **passive but `getAngry`** animal into temporary hostility — the provoked half of
 * `animaltypes.ini` aggression. If `target` is a {@link Settler} of a {@link isProvokableAnimal}
 * tribe, stamp/refresh an {@link Anger}`{until: tick + angryGameTime}` on it (`combatSystem` reads
 * the timer to make it fight back until it lapses). A re-strike before the timer expires **refreshes**
 * `until` (the latest provocation extends hostility, the original's "kept angry while harassed"
 * reading). No-ops for a non-`Settler` target, a non-animal/non-provokable tribe (a civilization, an
 * already-`aggressive` bear, an unknown tribe), or an `angryGameTime` of 0 (no readable duration → no
 * lasting anger). Pure of RNG/wall-clock — `until` is the integer `ctx.tick + angryGameTimeOf(...)`.
 */
function provokeAnger(world: World, ctx: SystemContext, target: Entity): void {
  const settler = world.tryGet(target, Settler);
  if (settler === undefined) return; // not a settler/animal — nothing to anger
  if (!isProvokableAnimal(ctx.content, settler.tribe)) return; // not a getAngry animal — no provocation
  // An ALREADY-aggressive animal needs no anger timer — it is hostile unconditionally, and stamping a
  // redundant `Anger` on it would leak a stale component `hostileAnimalNow` never reaps (it short-circuits
  // on `isAggressiveAnimal` before reading `Anger`). Only a passive getAngry animal is provoked.
  if (isAggressiveAnimal(ctx.content, settler.tribe)) return;
  const duration = angryGameTimeOf(ctx.content, settler.tribe);
  if (duration <= 0) return; // no readable anger duration — nothing to time
  const until = ctx.tick + duration;
  const anger = world.tryGet(target, Anger);
  if (anger === undefined) world.add(target, Anger, { until });
  else anger.until = until; // re-strike refreshes the timer (latest provocation wins)
}

/**
 * Resolve one completed `pickup`: move up to `amount` of `goodType` from a source store's
 * {@link Stockpile} onto the settler's back. Goods are conserved — the carrier gains exactly what
 * the source loses, so a pickup never creates or destroys goods (carriers haul; nothing teleports).
 * When `from` is null (a sourceless pickup) the goods simply appear carried; otherwise the available
 * amount caps the transfer (the source may have shrunk between the planner choosing it and the swing
 * completing — a competing system or another carrier). A source with nothing left to give is a no-op.
 */
function pickupFromStore(
  world: World,
  settler: Entity,
  from: Entity | null,
  goodType: number,
  amount: number,
): void {
  if (from === null) {
    addCarry(world, settler, goodType, amount);
    return;
  }
  const stock = world.tryGet(from, Stockpile);
  if (stock === undefined) return; // source gone — nothing to take (don't conjure goods)
  const have = stock.amounts.get(goodType) ?? 0;
  const moved = Math.min(amount, have);
  if (moved <= 0) return; // source emptied since the planner chose it — nothing to carry
  stock.amounts.set(goodType, have - moved);
  addCarry(world, settler, goodType, moved);
}

/**
 * Consume one unit of `goodType` food for an `eat` atomic: from the store `from` (a stockpile the
 * eater stands on) when given, else from the settler's own carried load. Goods are conserved — a unit
 * is removed only if one is actually present (the source may have emptied since the planner chose it,
 * or the carried load was deposited mid-swing); a missing source/empty slot is a no-op (no negative
 * stock, nothing conjured). The carried good fully consumed has its {@link Carrying} removed.
 */
function consumeFood(world: World, settler: Entity, from: Entity | null, goodType: number): void {
  if (from !== null) {
    const stock = world.tryGet(from, Stockpile);
    if (stock === undefined) return; // source gone — nothing to consume
    const have = stock.amounts.get(goodType) ?? 0;
    if (have <= 0) return; // emptied since the planner chose it — eat anyway, but take nothing
    stock.amounts.set(goodType, have - 1);
    return;
  }
  // No store: consume from the settler's own carried load.
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.goodType !== goodType || load.amount <= 0) return;
  if (load.amount > 1) load.amount -= 1;
  else world.remove(settler, Carrying); // last unit eaten — no longer carrying anything
}

/**
 * Add `amount` of `goodType` to a settler's carried load, merging if it already carries that good.
 *
 * A settler carries one good at a time (single-slot {@link Carrying}). Asking it to pick up a
 * *different* good while still loaded would silently overwrite — and so destroy — the held good,
 * breaking goods conservation. That can only be a planner bug (the planner must pile up the current
 * load first), so we throw rather than corrupt state (CLAUDE.md: throw for bugs).
 */
function addCarry(world: World, settler: Entity, goodType: number, amount: number): void {
  const held = world.tryGet(settler, Carrying);
  if (held !== undefined) {
    if (held.goodType !== goodType) {
      throw new Error(
        `settler ${settler} already carries good ${held.goodType}; cannot pick up good ${goodType} (pile up first)`,
      );
    }
    held.amount += amount;
    return;
  }
  world.add(settler, Carrying, { goodType, amount });
}

/**
 * Deposit a settler's carried load into a store's {@link Stockpile}, capped at the building type's
 * per-good capacity. Any overflow stays on the settler's back (goods are conserved — never dropped).
 * No-op if the settler carries nothing or the store has no stockpile.
 */
function pileupIntoStore(world: World, ctx: SystemContext, settler: Entity, store: Entity): void {
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return;
  const stock = world.tryGet(store, Stockpile);
  if (stock === undefined) return;

  const have = stock.amounts.get(load.goodType) ?? 0;
  const capacity = stockCapacity(world, ctx, store, load.goodType);
  const space = Math.max(0, capacity - have);
  const moved = Math.min(load.amount, space);
  if (moved <= 0) return; // store full for this good — keep carrying

  stock.amounts.set(load.goodType, have + moved);
  const remaining = load.amount - moved;
  if (remaining > 0) load.amount = remaining;
  else world.remove(settler, Carrying); // fully unloaded
}
