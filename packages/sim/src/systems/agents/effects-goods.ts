import {
  Carrying,
  Felling,
  GroundDrop,
  MineDeposit,
  Position,
  Resource,
  Stockpile,
  Stump,
} from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { unstampResourceFootprint } from '../footprint/index.js';
import { stockCapacity } from '../stores.js';

// The GOODS effects of the atomic executor — harvest/fell/deplete a resource node, drop and reap
// ground piles, pick up / consume / deposit a carried load. Every mutation conserves goods (nothing
// is conjured or silently destroyed); see each function's contract.

/**
 * Units a single completed `harvest` atomic yields — dropped/carried AND removed from the harvested
 * node. One unit per swing keeps the node draining in step with what leaves it, so goods are conserved
 * (a node of N units survives exactly N harvests). A real per-good yield (some nodes drop more per
 * swing) is a later balance slice — kept a constant so tuning is a diff.
 */
const HARVEST_YIELD = 1;

/**
 * Resolve one completed harvest swing, in one of three shapes decided by the node's own marker
 * components (never a hardcoded goodType — the lifecycle is content-declared and stamped at spawn):
 *
 *  - **Fellable node** (a tree, {@link Felling} present): the swing is a CHOP — it drives the node one
 *    step toward falling and grants NOTHING onto the settler's back. The whole yield lands at once as a
 *    ground trunk when the node comes down ({@link fellNode}, on the chop that zeroes `chopsLeft`), for
 *    the collector to carry off — the multi-hit harvest + drop-on-ground.
 *  - **Mined node** (stone/iron/gold/clay, {@link MineDeposit} present): the swing chips ONE unit off
 *    `remaining` and drops it at the node's cell as an ore pile ({@link dropMinedOre} — the felled-trunk
 *    shape, a unit at a time), which the collector then carries off; the deposit stays, shrinking a
 *    visual level, until its last unit is chipped, when it is removed ({@link depleteNode}).
 *  - **Bare node** (a mushroom, neither marker): the swing grants {@link HARVEST_YIELD} straight onto the
 *    settler's back (the direct pickup — no ground stage), and the node is removed once drained.
 *
 * A missing {@link Resource} means the node was already felled/exhausted between the swing starting and
 * completing (another collector beat this one to it) — the swing hit nothing, so it yields nothing;
 * likewise a `remaining <= 0` node is left untouched. Goods stay conserved (no unit is conjured for a
 * swing that landed on air, and a drained node's removal never doubles up).
 */
export function harvestFromNode(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  node: Entity,
  goodType: number,
): void {
  const res = world.tryGet(node, Resource);
  if (res === undefined) return; // node already felled/gone — the swing struck nothing (conserved)
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) {
    felling.chopsLeft -= 1;
    if (felling.chopsLeft <= 0) fellNode(world, ctx, node, res.goodType, res.remaining);
    return;
  }
  // A node emptied since the planner chose it (a competing collector took its last unit): nothing left
  // to give, so conserve goods and don't re-remove it (its own drain already removed it).
  if (res.remaining <= 0) return;
  const took = Math.min(HARVEST_YIELD, res.remaining);
  if (world.has(node, MineDeposit)) {
    dropMinedOre(world, node, res.goodType, took); // an ore pile at the deposit's cell, carried off later
  } else {
    addCarry(world, settler, goodType, took); // a mushroom — straight onto the back (direct pickup)
  }
  // Decrement only AFTER the unit is safely dropped/carried: were `addCarry` ever to reject (a full load),
  // the unit is not lost and the node isn't wrongly depleted. Belt-and-braces — the planner only reaches a
  // harvest empty-handed, so `addCarry` never throws today; this keeps the old throw-safe ordering anyway.
  res.remaining -= took;
  if (res.remaining <= 0) depleteNode(world, ctx, node, res.goodType); // last unit chipped — the node is gone
}

/**
 * Create a bare ground pile at (x,y) — a {@link Stockpile}+{@link Position}+{@link GroundDrop} holding
 * `amount` of `goodType`. This is the ONE on-the-ground drop shape a felled trunk and a chipped ore unit
 * both take, so the pickup/porter/delivery machinery (and `reapEmptyGroundDrop`) handle either unchanged —
 * defining it once keeps the two drop sites ({@link fellNode}, {@link dropMinedOre}) from drifting apart.
 * Returns the new entity so a caller can announce it. Pure over entity state; no RNG/wall-clock.
 */
function dropGroundPile(world: World, x: Fixed, y: Fixed, goodType: number, amount: number): Entity {
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[goodType, amount]]) });
  world.add(pile, GroundDrop, { goodType });
  return pile;
}

/**
 * Fell a {@link Felling} node whose last chop just landed: remove the standing node (so the planner
 * never re-scans a depleted stump-to-be — the fix for the old "skip a `remaining <= 0` node forever"),
 * drop its whole `yield` at its cell as a bare {@link Stockpile} trunk pile (a {@link GroundDrop} the
 * collector then carries off, consumed by the unchanged pickup/porter/delivery machinery), leave a
 * {@link Stump} decor where it stood, and announce it (`resourceFelled`) for render/audio. Goods are
 * conserved — the trunk holds exactly what the standing node was worth, nothing created or lost by the
 * tree coming down. The node's `goodType`/`yield` are read BEFORE the destroy (the component object is
 * dropped from its store by `world.destroy`). Pure over entity state; no RNG/wall-clock.
 */
function fellNode(
  world: World,
  ctx: SystemContext,
  node: Entity,
  goodType: number,
  yieldAmount: number,
): void {
  const pos = world.get(node, Position);
  const { x, y } = pos;
  // The felled wood: a ground trunk pile holding the whole yield, at the node's cell (the shared drop shape,
  // so the collector's own-trunk drive + the emptied-pile cleanup handle it — see reapEmptyGroundDrop).
  const trunk = dropGroundPile(world, x, y, goodType, yieldAmount);
  // The stump / debris left where the tree stood — pure decor (non-blocking, not harvestable).
  const stump = world.create();
  world.add(stump, Position, { x, y });
  world.add(stump, Stump, { goodType });
  // The standing node is gone from every planner scan from here on.
  unstampResourceFootprint(world, node);
  world.destroy(node);
  ctx.events.emit({
    kind: 'resourceFelled',
    node,
    trunk,
    stump,
    goodType,
    amount: yieldAmount,
    at: { x: fx.toInt(x), y: fx.toInt(y) },
  });
}

/**
 * Drop one swing's worth of a mined {@link MineDeposit} deposit at the node's cell as a bare
 * {@link Stockpile} ore pile (a {@link GroundDrop}) — the SAME on-the-ground shape a felled trunk takes,
 * so the collector's own-trunk drive + the porter/delivery machinery carry it off unchanged (and the
 * pile is auto-reaped when emptied, see {@link reapEmptyGroundDrop}). The deposit node itself is left
 * standing (drained by one in {@link harvestFromNode}); it is removed only when its last unit is chipped
 * ({@link depleteNode}). Goods are conserved — the pile holds exactly the unit drained off the deposit,
 * nothing conjured. Pure over entity state; no RNG/wall-clock.
 */
function dropMinedOre(world: World, node: Entity, goodType: number, amount: number): void {
  const { x, y } = world.get(node, Position);
  dropGroundPile(world, x, y, goodType, amount); // the shared felled-trunk shape, one unit's worth
}

/**
 * Remove an EXHAUSTED {@link Resource} node (a mined deposit whose last unit was just chipped, or a bare
 * mushroom after its single pickup) and announce it (`resourceDepleted`) for audio/effects and the Step-5
 * collision-unblock seam. Unlike {@link fellNode} it leaves nothing behind — the yield already dropped as
 * ore piles / went onto the back — it just deletes the node so the planner never re-scans a spent deposit
 * (the fix for the old "skip a `remaining <= 0` node forever"). The node's cell is read BEFORE the destroy
 * (the component object is dropped from its store by `world.destroy`). Pure over entity state; no RNG.
 */
function depleteNode(world: World, ctx: SystemContext, node: Entity, goodType: number): void {
  const pos = world.get(node, Position);
  const at = { x: fx.toInt(pos.x), y: fx.toInt(pos.y) };
  unstampResourceFootprint(world, node);
  world.destroy(node);
  ctx.events.emit({ kind: 'resourceDepleted', node, goodType, at });
}

/**
 * Resolve one completed `pickup`: move up to `amount` of `goodType` from a source store's
 * {@link Stockpile} onto the settler's back. Goods are conserved — the carrier gains exactly what
 * the source loses, so a pickup never creates or destroys goods (carriers haul; nothing teleports).
 * When `from` is null (a sourceless pickup) the goods simply appear carried; otherwise the available
 * amount caps the transfer (the source may have shrunk between the planner choosing it and the swing
 * completing — a competing system or another carrier). A source with nothing left to give is a no-op.
 */
export function pickupFromStore(
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
  reapEmptyGroundDrop(world, from); // a fully-collected felled trunk vanishes (a designated flag stays)
}

/**
 * Reap a bare {@link GroundDrop} pile (a felled trunk / dropped-good heap) once a pickup has emptied it,
 * so a long game doesn't accrete an empty pile per felled tree. Only a `GroundDrop` is auto-removed — a
 * *designated* delivery flag (an equally-bare `Stockpile` with no marker) persists as a collection
 * point. The emptiness test reads the `amounts` for a pure "holds nothing" predicate (not an
 * order-dependent choice), so raw Map iteration is fine here. No-op for a non-drop / still-stocked pile.
 */
function reapEmptyGroundDrop(world: World, pile: Entity): void {
  if (!world.has(pile, GroundDrop)) return; // a designated flag / building store — never auto-reaped
  const stock = world.tryGet(pile, Stockpile);
  if (stock === undefined) return;
  for (const amount of stock.amounts.values()) if (amount > 0) return; // still holds something
  world.destroy(pile);
}

/**
 * Consume one unit of `goodType` food for an `eat` atomic: from the store `from` (a stockpile the
 * eater stands on) when given, else from the settler's own carried load. Goods are conserved — a unit
 * is removed only if one is actually present (the source may have emptied since the planner chose it,
 * or the carried load was deposited mid-swing); a missing source/empty slot is a no-op (no negative
 * stock, nothing conjured). The carried good fully consumed has its {@link Carrying} removed.
 */
export function consumeFood(world: World, settler: Entity, from: Entity | null, goodType: number): void {
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
  shrinkCarry(world, settler, load, 1); // last unit eaten ⇒ no longer carrying anything
}

/** Shrink a settler's carried load by `by` units, removing the {@link Carrying} entirely when that
 *  empties it — the shared decrement-or-remove step of eating a carried unit and unloading a pile. */
function shrinkCarry(world: World, settler: Entity, load: { amount: number }, by: number): void {
  if (load.amount > by) load.amount -= by;
  else world.remove(settler, Carrying);
}

/**
 * Add `amount` of `goodType` to a settler's carried load, merging if it already carries that good.
 *
 * A settler carries one good at a time (single-slot {@link Carrying}). Asking it to pick up a
 * *different* good while still loaded would silently overwrite — and so destroy — the held good,
 * breaking goods conservation. That can only be a planner bug (the planner must pile up the current
 * load first), so we throw rather than corrupt state (AGENTS.md: throw for bugs).
 */
export function addCarry(world: World, settler: Entity, goodType: number, amount: number): void {
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
export function pileupIntoStore(world: World, ctx: SystemContext, settler: Entity, store: Entity): void {
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
  shrinkCarry(world, settler, load, moved); // fully unloaded ⇒ Carrying removed
}
