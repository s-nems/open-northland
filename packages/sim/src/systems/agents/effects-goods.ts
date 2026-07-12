import {
  BerryBush,
  Building,
  Carrying,
  Crop,
  DeliveryFlag,
  Felling,
  GroundDrop,
  HarvestedBy,
  MineDeposit,
  Position,
  Resource,
  Stockpile,
  Stump,
  Vehicle,
  WorkFlag,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Fixed } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { BERRY_REGROW_TICKS } from '../economy/berries.js';
import { unstampResourceFootprint } from '../footprint/index.js';
import { isYardHeap, lowestStockedGood, stockCapacity } from '../stores.js';

// The GOODS effects of the atomic executor — harvest/fell/deplete a resource node, drop and reap
// ground piles, pick up / consume / deposit a carried load. Every mutation conserves goods (nothing
// is conjured or silently destroyed); see each function's contract.

/**
 * Consecutive work swings a gatherer lands BEFORE standing its inter-swing breather — the observed
 * work rhythm: the original's collector swings a couple of times in a row, then rests ~0.5–1 s, then
 * swings again ("po dwóch zamachach staje bezczynnie"). No readable data field paces this (the
 * animations carry only the per-swing cycle); a rest after EVERY swing read as a strange stutter, so
 * the breather lands only on every {@link HARVEST_SWINGS_PER_REST}-th swing of a job still in
 * progress ({@link restAfterHarvest}).
 */
export const HARVEST_SWINGS_PER_REST = 2;

/**
 * Whether the swing that JUST resolved against `node` left its multi-swing job STILL IN PROGRESS —
 * the executor then CHAINS the next swing (or the breather) directly instead of releasing the
 * settler for a tick: the one-tick planner gap between swings drew a flick of the idle pose
 * mid-work (the reported "mignięcie" between strikes). True only for a standing {@link Felling}
 * tree with chops left or a {@link MineDeposit} mid-unit (`strikes` advanced but the unit not yet
 * loose); the swing that fells / chips a unit loose / depletes releases the settler — the planner
 * routes the pickup/carry, which is the job's natural break. A plain node (a mushroom — gone after
 * its single pluck) never chains.
 */
export function continuesHarvest(world: World, node: Entity): boolean {
  if (!world.has(node, Resource)) return false; // felled/depleted/plucked — carrying is the break
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) return felling.chopsLeft > 0;
  const deposit = world.tryGet(node, MineDeposit);
  if (deposit !== undefined) return (deposit.strikes ?? 0) > 0; // 0 = a unit just came loose
  return false;
}

/**
 * Whether the swing that JUST resolved against `node` should chain into the inter-swing breather
 * (the executor's `HARVEST_REST_TICKS` hold): a {@link continuesHarvest} job whose swing count sits
 * on a {@link HARVEST_SWINGS_PER_REST} boundary, read off the node's own counters (a {@link Felling}
 * tree's `chopsLeft`, a {@link MineDeposit}'s `strikes`). Off-boundary swings chain straight into
 * the next swing instead.
 */
export function restAfterHarvest(world: World, node: Entity): boolean {
  if (!continuesHarvest(world, node)) return false;
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) return felling.chopsLeft % HARVEST_SWINGS_PER_REST === 0;
  const deposit = world.tryGet(node, MineDeposit);
  if (deposit !== undefined) return (deposit.strikes ?? 0) % HARVEST_SWINGS_PER_REST === 0;
  return false;
}

/**
 * Units a single completed `harvest` atomic yields — dropped/carried AND removed from the harvested
 * node. One unit per swing keeps the node draining in step with what leaves it, so goods are conserved
 * (a node of N units survives exactly N harvests). A real per-good yield (some nodes drop more per
 * swing) is a later balance slice — kept a constant so tuning is a diff.
 */
const HARVEST_YIELD = 1;

/**
 * Resolve one completed harvest swing, in one of four shapes decided by the node's own marker
 * components (never a hardcoded goodType — the lifecycle is content-declared and stamped at spawn):
 *
 *  - **Sown field** (wheat, {@link Crop} present): the swing is a REAP — a RIPE field (its `remaining`
 *    was set to its yield by the CropGrowthSystem) drops that whole yield at its node as a ground sheaf
 *    ({@link GroundDrop}, the good's `landscapeToPickup` look — the cut wheat lying on the field) and
 *    the field is removed, freeing the tile to sow again; an unripe/raced field (`remaining <= 0`)
 *    yields nothing (the scythe cut stubble). Checked FIRST — a field is neither felled nor mined.
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
  if (world.has(node, Crop)) {
    reapField(world, node, res);
    return;
  }
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) {
    felling.chopsLeft -= 1;
    world.touch(node); // in-place write on a snapshot-cached scenery entity — log it (World.touch doc)
    if (felling.chopsLeft <= 0) fellNode(world, ctx, settler, node, res.goodType, res.remaining);
    return;
  }
  // A node emptied since the planner chose it (a competing collector took its last unit): nothing left
  // to give, so conserve goods and don't re-remove it (its own drain already removed it).
  if (res.remaining <= 0) return;
  const took = Math.min(HARVEST_YIELD, res.remaining);
  const deposit = world.tryGet(node, MineDeposit);
  if (deposit !== undefined) {
    // Several strikes chip ONE unit (OBSERVED calibration, see MineDeposit doc — the data pins only
    // the single-swing cycle length): only the strike that completes the unit drops ore and drains
    // the node; earlier strikes just advance the counter, so the deposit reads as WORKED. A legacy
    // 1-strike deposit never touches the counter, so its unstamped component shape (hash) survives
    // being worked — the guarantee `createResourceNode`'s conditional stamp promises.
    const strikesPerUnit = deposit.strikesPerUnit ?? 1;
    if (strikesPerUnit > 1) {
      deposit.strikes = (deposit.strikes ?? 0) + 1;
      world.touch(node); // in-place write on a snapshot-cached scenery entity — log it (World.touch doc)
      if (deposit.strikes < strikesPerUnit) return;
      deposit.strikes = 0;
    }
    dropMinedOre(world, settler, node, res.goodType, took); // an ore pile at the deposit's cell, carried off later
  } else {
    addCarry(world, settler, goodType, took); // a mushroom — straight onto the back (direct pickup)
  }
  // Decrement only AFTER the unit is safely dropped/carried: were `addCarry` ever to reject (a full load),
  // the unit is not lost and the node isn't wrongly depleted. Belt-and-braces — the planner only reaches a
  // harvest empty-handed, so `addCarry` never throws today; this keeps the old throw-safe ordering anyway.
  res.remaining -= took;
  world.touch(node); // in-place write on a snapshot-cached scenery entity — log it (World.touch doc)
  if (res.remaining <= 0) {
    depleteNode(world, ctx, node, res.goodType); // last unit chipped — the node is gone
  } else if (world.has(node, MineDeposit)) {
    // A surviving deposit shrank a unit — announce it (`resourceMined`) so the map view hands the node
    // from its static decor layer to the live sprite pool (and audio can hook a chip effect).
    const pos = world.get(node, Position);
    ctx.events.emit({ kind: 'resourceMined', node, goodType: res.goodType, at: eventAt(pos.x, pos.y) });
  }
}

/**
 * Reap a RIPE {@link Crop} field: drop its whole yield (`Resource.remaining`, set by the
 * CropGrowthSystem at ripeness) at its node as a ground sheaf pile — the SAME {@link GroundDrop} shape
 * a felled trunk takes, so the farmer's pickup + the porter/delivery machinery carry it off unchanged
 * (it draws the good's `landscapeToPickup` "cut wheat" look) — and remove the field, freeing the tile
 * to sow again. An UNRIPE field (`remaining <= 0` — the growth system hasn't ripened it, or a competing
 * farmer reaped it mid-swing) yields nothing and stays standing: the scythe cut stubble, goods
 * conserved. No owner stamp (a farm's fields are shared by all its farmers) and no stump — the field
 * clears to bare ground, faithful to the original's wheat cycle (`wheat (growing)` → `wheat
 * (harvested)` sheaf → carried to the farm). A field never stamps a {@link ResourceFootprint} (wheat is
 * walkable in the data), so there is no collision overlay to release. Pure over entity state; no RNG.
 */
function reapField(world: World, node: Entity, res: { goodType: number; remaining: number }): void {
  if (res.remaining <= 0) return; // unripe / raced — the swing cut stubble (nothing conjured)
  const { x, y } = world.get(node, Position);
  dropGroundPile(world, x, y, res.goodType, res.remaining);
  world.destroy(node);
}

/**
 * Create a bare ground pile at (x,y) — a {@link Stockpile}+{@link Position}+{@link GroundDrop} holding
 * `amount` of `goodType`. This is the ONE on-the-ground drop shape a felled trunk and a chipped ore unit
 * both take, so the pickup/porter/delivery machinery (and `reapEmptyGroundDrop`) handle either unchanged —
 * defining it once keeps the two drop sites ({@link fellNode}, {@link dropMinedOre}) from drifting apart.
 * Returns the new entity so a caller can announce it. Pure over entity state; no RNG/wall-clock.
 *
 * Also the assembly the `dropGood` command routes through (via `command.ts`), so a harvest-dropped pile and
 * a player-dropped pile are byte-identical entities.
 */
export function dropGroundPile(world: World, x: Fixed, y: Fixed, goodType: number, amount: number): Entity {
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[goodType, amount]]) });
  world.add(pile, GroundDrop, { goodType });
  return pile;
}

/**
 * The most units a loose ground pile can hold on one tile — the per-tile cap for BOTH a player-dropped heap
 * ({@link dropOrStackGood}) and a gatherer's yard heap ({@link stackOntoTile} / `nearestFreeYardNode`). The
 * `ls_goods` heap has this many growth states (a single-unit heap at fill 1, a full one at
 * {@link MAX_GROUND_STACK}), so a pile can't grow past what its graphic can show — a drop caps here and
 * spills to the next tile (yard) or is dropped (hand-placed). Source basis: `ls_goods.bmd` carries 5 fill
 * states per good pile (the pipeline's goods stage).
 */
export const MAX_GROUND_STACK = 5;

/**
 * Drop `amount` of `goodType` as a loose ground pile at (x,y), STACKING onto an existing loose pile of the
 * same good already on that tile (up to {@link MAX_GROUND_STACK}) instead of littering a fresh entity per
 * drop — the assembly the `dropGood` command routes through (a player/admin placing goods by hand, one unit
 * per click). A loose pile is a bare {@link Stockpile}+{@link Position} with NO {@link GroundDrop}/
 * {@link Building} marker: it draws as a per-fill heap that GROWS with its contents and just rests there
 * (neither a felled-trunk pickup source nor a building delivery sink), so placed goods stay put and visibly
 * pile up — distinct from {@link dropGroundPile}'s haulable felled-trunk shape.
 *
 * Determinism: the pile to stack onto is the first match in canonical id order ({@link World.canonicalEntities}),
 * a which-entity-wins pick that MUST be canonical (AGENTS.md). Only a pile holding this good (or nothing) is
 * merged — a heap of a different good on the same tile is left alone, so no good is ever overwritten. Returns
 * the stacked/created pile. Pure over entity state; no RNG/wall-clock.
 */
export function dropOrStackGood(world: World, x: Fixed, y: Fixed, goodType: number, amount: number): Entity {
  for (const e of world.canonicalEntities()) {
    if (world.has(e, GroundDrop) || world.has(e, Building)) continue; // a trunk / a building store — not ours
    const stock = world.tryGet(e, Stockpile);
    const pos = world.tryGet(e, Position);
    if (stock === undefined || pos === undefined) continue;
    if (pos.x !== x || pos.y !== y) continue; // a different tile
    const have = stock.amounts.get(goodType) ?? 0;
    if (have <= 0 && stock.amounts.size > 0) continue; // holds a DIFFERENT good — never overwrite it
    stock.amounts.set(goodType, Math.min(MAX_GROUND_STACK, have + amount));
    return e;
  }
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[goodType, Math.min(MAX_GROUND_STACK, amount)]]) });
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
  feller: Entity,
  node: Entity,
  goodType: number,
  yieldAmount: number,
): void {
  const pos = world.get(node, Position);
  const { x, y } = pos;
  // The felled wood: a ground trunk pile holding the whole yield, at the node's cell (the shared drop shape,
  // so the collector's own-trunk drive + the emptied-pile cleanup handle it — see reapEmptyGroundDrop).
  const trunk = dropGroundPile(world, x, y, goodType, yieldAmount);
  stampDropOwner(world, trunk, feller); // a flag-bound feller owns its trunk; a flagless one leaves it unmarked
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
    at: eventAt(x, y),
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
function dropMinedOre(world: World, miner: Entity, node: Entity, goodType: number, amount: number): void {
  const { x, y } = world.get(node, Position);
  const pile = dropGroundPile(world, x, y, goodType, amount); // the shared felled-trunk shape, one unit's worth
  stampDropOwner(world, pile, miner); // a flag-bound miner owns its ore pile; a flagless one leaves it unmarked
}

/**
 * Record who HARVESTED a fresh ground drop, but ONLY when that harvester is a **flag-bound gatherer** (it
 * carries a {@link WorkFlag}). The mark ({@link HarvestedBy}) is what lets that gatherer later reclaim
 * *only its own* trunk/ore and leave every other loose pile alone. A flagless collector (the golden slice's
 * woodcutter) stamps nothing, so its drop hashes and is collected exactly as before — the ownership rule is
 * inert wherever no flag-bound gatherer works (the separate-optional-component pattern).
 */
function stampDropOwner(world: World, drop: Entity, harvester: Entity): void {
  if (world.has(harvester, WorkFlag)) world.add(drop, HarvestedBy, { by: harvester });
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
  const at = eventAt(pos.x, pos.y);
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
  reapEmptyLoosePile(world, from); // a fully-collected trunk / yard heap vanishes (a warehouse/hull stays)
}

/**
 * Reap a LOOSE ground pile once a pickup has emptied it, so a long game doesn't accrete a dead heap per
 * felled tree or delivered load. A loose pile is any positioned {@link Stockpile} that is NOT a persistent
 * store — a {@link Building} warehouse and a {@link Vehicle} hull both keep their empty stock and are left
 * alone. This covers a felled/dropped {@link GroundDrop} trunk AND a bare gatherer-yard / player-dropped
 * heap (which carries no marker): an emptied yard tile vanishes instead of lingering as a zero heap that
 * would mis-render as a flag and read as "free but unfillable" to the yard scan. The emptiness test reads
 * `amounts` for a pure "holds nothing" predicate (not an order-dependent choice), so raw Map iteration is
 * fine. No-op for a persistent store / a still-stocked pile. (A delivery flag has no `Stockpile`, so it
 * never reaches here.)
 */
function reapEmptyLoosePile(world: World, pile: Entity): void {
  if (world.has(pile, Building) || world.has(pile, Vehicle)) return; // a persistent store — keep it empty
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

/**
 * Forage a RIPE {@link BerryBush} for a completed `forage` atomic: the bush's one serving is eaten, so it
 * flips ripe→bare and schedules its regrow ({@link BERRY_REGROW_TICKS} ticks out, the exact-integer
 * `ripeAtTick` the BerryGrowthSystem compares against), and a `berryForaged` event fires (the render's
 * static→live handover cue). A bush that is already bare (another forager beat this one to it since the
 * planner chose it) or gone is a no-op — nothing to give — but the AtomicSystem still zeroes hunger (the
 * bite was taken), the same raced-source stance as {@link consumeFood}'s emptied store. The bush entity
 * persists (it regrows in place, unlike a depleted {@link Resource} node that is destroyed). The in-place
 * write is `World.touch`ed because a bush is a snapshot-cached scenery entity. Pure over entity state +
 * the tick counter; no RNG/wall-clock.
 */
export function forageBerry(world: World, ctx: SystemContext, bush: Entity): void {
  const b = world.tryGet(bush, BerryBush);
  if (b === undefined || !b.ripe) return; // bare/gone since the planner chose it — nothing to eat
  b.ripe = false;
  b.ripeAtTick = ctx.tick + BERRY_REGROW_TICKS;
  world.touch(bush); // in-place write on a snapshot-cached scenery entity — log it (World.touch doc)
  const pos = world.get(bush, Position);
  ctx.events.emit({ kind: 'berryForaged', bush, at: eventAt(pos.x, pos.y) });
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
 * Deposit a settler's carried load. A **delivery flag** ({@link DeliveryFlag}) is a MARKER, not a store:
 * the load drops onto a loose ground heap on the tile the gatherer STANDS on ({@link dropCarryAtOwnTile}),
 * capped per tile — the planner walked it to a free yard tile first (`nearestFreeYardNode`), so the goods
 * land where its feet are and never teleport, and each heap is pinned to its own tile so relocating the
 * flag moves nothing already dropped. Any other store takes the load into its own {@link Stockpile}, capped
 * at the building type's per-good capacity, overflow staying on the settler's back (goods conserved). No-op
 * if the settler carries nothing or the (non-flag) store has no stockpile.
 */
export function pileupIntoStore(world: World, ctx: SystemContext, settler: Entity, store: Entity): void {
  if (world.has(store, DeliveryFlag)) {
    dropCarryAtOwnTile(world, settler);
    return;
  }
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

/**
 * Drop a settler's carried load onto a loose ground heap on the tile it STANDS on — the observed "collector
 * sets its harvest down where its feet are". Two callers: a flag-bound gatherer banking its harvest (the
 * planner walked it to a free yard tile via `nearestFreeYardNode`), and a PORTER setting a surplus load down
 * when no store can take it (see `planDelivery`) — it sheds the undepositable good and is free to haul a
 * deliverable one. Banks up to {@link MAX_GROUND_STACK} onto the tile; any remainder stays on its back and
 * the next drop walks it on (it PHYSICALLY carries the spill — nothing teleports). The heap is snapped to the
 * settler's half-cell NODE ({@link positionOfNode}), NOT its exact fractional Position, so every drop on a
 * node stacks onto the same heap and heaps sit tile-to-tile on the lattice. Returns how many units were set
 * down (0 when the tile is full / holds a different good — the caller then keeps the load). No-op if it
 * carries nothing / has no position. Pure over entity state; no RNG/wall-clock.
 */
export function dropCarryAtOwnTile(world: World, settler: Entity): number {
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return 0;
  const pos = world.tryGet(settler, Position);
  if (pos === undefined) return 0;
  const node = nodeOfPosition(pos.x, pos.y);
  const at = positionOfNode(node.hx, node.hy); // the node's canonical lattice Position, so drops stack
  const placed = stackOntoTile(world, at.x, at.y, load.goodType, load.amount);
  if (placed > 0) shrinkCarry(world, settler, load, placed); // fully placed ⇒ Carrying removed
  return placed;
}

/**
 * Stack up to `want` units of `good` onto the loose ground HEAP at exactly `(x, y)`, capped at
 * {@link MAX_GROUND_STACK}; create the heap when none is there yet. Returns how many units were actually
 * placed — `0` when the tile is full OR already holds a DIFFERENT good (never overwritten; the caller then
 * carries the remainder to the next tile). A loose heap is a bare {@link Stockpile}+{@link Position} with no
 * {@link GroundDrop}/{@link Building}/{@link DeliveryFlag} marker — the yard tile a gatherer stacks onto,
 * distinct from an uncollected trunk, a building store, and the flag marker itself (all excluded).
 *
 * Determinism: the heap to stack onto is the first match in canonical id order
 * ({@link World.canonicalEntities}), a which-entity-wins pick that MUST be canonical (AGENTS.md). The
 * felled-trunk-free twin of {@link dropOrStackGood} — the difference is the overflow policy: this REPORTS
 * the placed count so the caller can carry the remainder to the next tile, where `dropOrStackGood`
 * (a hand-placed pile) silently drops it.
 */
function stackOntoTile(world: World, x: Fixed, y: Fixed, good: number, want: number): number {
  if (want <= 0) return 0;
  for (const e of world.canonicalEntities()) {
    if (!isYardHeap(world, e)) continue;
    const stock = world.get(e, Stockpile);
    const pos = world.get(e, Position);
    if (pos.x !== x || pos.y !== y) continue; // a different tile
    // Skip a tile occupied by a DIFFERENT good; a heap of OUR good (even one drained to 0 by a porter and
    // not yet reaped) is stackable — testing the stocked good, not `size`, is what keeps a re-fill from
    // livelocking against a stale zero entry.
    const other = lowestStockedGood(stock);
    if (other !== null && other !== good) return 0;
    const have = stock.amounts.get(good) ?? 0;
    const placed = Math.min(MAX_GROUND_STACK - have, want);
    if (placed <= 0) return 0; // this tile is full for the good
    stock.amounts.set(good, have + placed);
    return placed;
  }
  // No heap on this tile yet — start one with up to a full stack.
  const placed = Math.min(MAX_GROUND_STACK, want);
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[good, placed]]) });
  return placed;
}
