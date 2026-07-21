import {
  Crop,
  Felling,
  HarvestedBy,
  MineDeposit,
  Position,
  Resource,
  Stump,
  WorkFlag,
} from '../../../components/index.js';
import { eventAt } from '../../../core/events.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { unstampResourceFootprint } from '../../footprint/index.js';
import { addCarry } from './carry.js';
import { dropGroundPile } from './piles.js';

// The harvest effect: resolve one completed swing against a resource node — reap a field, chop a tree,
// chip a mined deposit, or pluck a bare node — and the felled-trunk / ore-pile / depletion drops that
// follow. Every mutation conserves goods.

/**
 * Consecutive work swings a gatherer lands before standing its inter-swing breather.
 *
 * source-basis (observed): the original's collector swings a couple of times in a row, then rests ~0.5–1 s,
 * then swings again. No readable data field paces this (the animations carry only the per-swing cycle), and
 * a rest after every swing reads as a stutter, so the breather lands only on every
 * {@link HARVEST_SWINGS_PER_REST}-th swing of a job still in progress ({@link restAfterHarvest}).
 */
export const HARVEST_SWINGS_PER_REST = 2;

/**
 * Whether the swing that just resolved against `node` left its multi-swing job still in progress — the
 * executor then chains the next swing (or the breather) directly instead of releasing the settler for a
 * tick, since the one-tick planner gap between swings draws a flick of the idle pose mid-work. True only
 * for a standing {@link Felling} tree with chops left or a {@link MineDeposit} mid-unit (`strikes` advanced
 * but the unit not yet loose); the swing that fells / chips a unit loose / depletes releases the settler,
 * and the planner routes the pickup/carry — the job's natural break. A plain node (a mushroom, gone after
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
 * Whether the swing that just resolved against `node` should chain into the inter-swing breather: a
 * {@link continuesHarvest} job whose swing count sits on a {@link HARVEST_SWINGS_PER_REST} boundary, read
 * off the node's own counters (a {@link Felling} tree's `chopsLeft`, a {@link MineDeposit}'s `strikes`).
 * Off-boundary swings chain straight into the next swing instead.
 */
function restAfterHarvest(world: World, node: Entity): boolean {
  if (!continuesHarvest(world, node)) return false;
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) return felling.chopsLeft % HARVEST_SWINGS_PER_REST === 0;
  const deposit = world.tryGet(node, MineDeposit);
  if (deposit !== undefined) return (deposit.strikes ?? 0) % HARVEST_SWINGS_PER_REST === 0;
  return false;
}

/**
 * The idle breather a gatherer stands between work-swing bursts, in ticks (1.25 s at 12 ticks/s).
 *
 * source-basis (observed): the original's collector swings a couple of times in a row, rests ~0.5–1 s, and
 * swings again, but the readable data carries no rest field — `atomicanimations.ini` lengths cover only the
 * swing itself (its trailing idle pad is ~4 frames, far shorter).
 */
const HARVEST_REST_TICKS = 15;

/** The part of a running {@link import('../../../components/index.js').CurrentAtomic} the rest tail owns. */
interface RestTailAtomic {
  duration: number;
  restTail?: boolean;
}

/**
 * Hold a just-completed harvest swing open as its inter-swing breather when the node's swing count calls
 * for one ({@link restAfterHarvest}), reporting whether the tail began. Never after the final swing
 * (felled/depleted/plucked — the settler moves straight on to carrying).
 *
 * The tail is the SAME atomic extended, not a second one, so the render keeps the swing's binding and
 * stands its ready stance instead of snapping to another animation. Invariant: `duration` carries
 * {@link HARVEST_REST_TICKS} extra ticks exactly while `restTail` is set, and {@link endRestTail} is the
 * one reversal of both — the pair must stay matched or an inflated duration reaches `hashState()`.
 */
export function beginRestTail(world: World, atomic: RestTailAtomic, node: Entity): boolean {
  if (HARVEST_REST_TICKS <= 0 || !restAfterHarvest(world, node)) return false;
  atomic.duration += HARVEST_REST_TICKS;
  atomic.restTail = true;
  return true;
}

/** End a breather {@link beginRestTail} began: drop the extra ticks and the marker, restoring the swing's
 *  own animation length and the component's exact pre-rest shape. */
export function endRestTail(atomic: RestTailAtomic): void {
  delete atomic.restTail;
  atomic.duration -= HARVEST_REST_TICKS;
}

/**
 * Units a single completed `harvest` atomic yields — dropped/carried and removed from the harvested node. One
 * unit per swing keeps the node draining in step with what leaves it, so goods are conserved (a node of N units
 * survives exactly N harvests). A real per-good yield (some nodes drop more per swing) is a later balance slice
 * — kept a constant so tuning is a diff.
 */
const HARVEST_YIELD = 1;

/**
 * Resolve one completed harvest swing, in one of four shapes decided by the node's own marker
 * components (never a hardcoded goodType — the lifecycle is content-declared and stamped at spawn):
 *
 *  - **Sown field** (wheat, {@link Crop} present): the swing is a reap — a ripe field (its `remaining` was
 *    set to its yield by the CropGrowthSystem) drops that whole yield at its node as a ground sheaf
 *    ({@link GroundDrop}, the good's `landscapeToPickup` look) and the field is removed, freeing the tile to
 *    sow again; an unripe/raced field (`remaining <= 0`) yields nothing. Checked first — a field is neither
 *    felled nor mined.
 *  - **Fellable node** (a tree, {@link Felling} present): the swing is a chop — it drives the node one step
 *    toward falling and grants nothing onto the settler's back. The whole yield lands at once as a ground trunk
 *    when the node comes down ({@link fellNode}, on the chop that zeroes `chopsLeft`), for the collector to
 *    carry off.
 *  - **Mined node** (stone/iron/gold/clay, {@link MineDeposit} present): the swing chips one unit off
 *    `remaining` and drops it at the node's cell as an ore pile ({@link dropMinedOre}), which the collector
 *    then carries off; the deposit stays, shrinking a visual level, until its last unit is chipped, when it is
 *    removed ({@link depleteNode}).
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
    // Several strikes chip one unit (observed calibration, see MineDeposit doc — the data pins only the
    // single-swing cycle length): only the strike that completes the unit drops ore and drains the node;
    // earlier strikes just advance the counter. A legacy 1-strike deposit never touches the counter, so its
    // unstamped component shape (hash) survives being worked — the guarantee `createResourceNode`'s conditional
    // stamp promises.
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
  // Decrement only after the unit is safely dropped/carried: were `addCarry` ever to reject (a full load), the
  // unit is not lost and the node isn't wrongly depleted. The planner only reaches a harvest empty-handed, so
  // `addCarry` never throws today; this keeps the throw-safe ordering anyway.
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
 * Reap a ripe {@link Crop} field: drop its whole yield (`Resource.remaining`, set by the CropGrowthSystem at
 * ripeness) at its node as a ground sheaf pile — the same {@link GroundDrop} shape a felled trunk takes, so the
 * farmer's pickup + the porter/delivery machinery carry it off unchanged (it draws the good's
 * `landscapeToPickup` "cut wheat" look) — and remove the field, freeing the tile to sow again. An unripe field
 * (`remaining <= 0`) yields nothing and stays standing (goods conserved). No owner stamp (a farm's fields are
 * shared by all its farmers) and no stump — the field clears to bare ground, faithful to the original's wheat
 * cycle.
 */
function reapField(world: World, node: Entity, res: { goodType: number; remaining: number }): void {
  if (res.remaining <= 0) return; // unripe / raced — the swing cut stubble (nothing conjured)
  const { x, y } = world.get(node, Position);
  dropGroundPile(world, x, y, res.goodType, res.remaining);
  unstampResourceFootprint(world, node); // through the incremental cache, never a full overlay rebuild
  world.destroy(node);
}

/**
 * Fell a {@link Felling} node whose last chop just landed: remove the standing node (so the planner never
 * re-scans a depleted stump-to-be), drop its whole `yield` at its cell as a bare {@link Stockpile} trunk pile
 * (a {@link GroundDrop} the collector then carries off), leave a {@link Stump} decor where it stood, and
 * announce it (`resourceFelled`) for render/audio. Goods are conserved — the trunk holds exactly what the
 * standing node was worth. The node's `goodType`/`yield` are read before the destroy (the component object is
 * dropped from its store by `world.destroy`).
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
 * Drop one swing's worth of a mined {@link MineDeposit} deposit at the node's cell as a bare {@link Stockpile}
 * ore pile (a {@link GroundDrop}) — the same on-the-ground shape a felled trunk takes, so the collector's
 * own-trunk drive + the porter/delivery machinery carry it off unchanged (and the pile is auto-reaped when
 * emptied, see {@link reapEmptyGroundDrop}). The deposit node itself is left standing (drained by one in
 * {@link harvestFromNode}); it is removed only when its last unit is chipped ({@link depleteNode}). Goods are
 * conserved — the pile holds exactly the unit drained off the deposit.
 */
function dropMinedOre(world: World, miner: Entity, node: Entity, goodType: number, amount: number): void {
  const { x, y } = world.get(node, Position);
  const pile = dropGroundPile(world, x, y, goodType, amount); // the shared felled-trunk shape, one unit's worth
  stampDropOwner(world, pile, miner); // a flag-bound miner owns its ore pile; a flagless one leaves it unmarked
}

/**
 * Record who harvested a fresh ground drop, but only when that harvester is a flag-bound gatherer (it carries a
 * {@link WorkFlag}). The mark ({@link HarvestedBy}) is what lets that gatherer later reclaim only its own
 * trunk/ore and leave every other loose pile alone. A flagless collector stamps nothing, so its drop hashes and
 * is collected as normal — the ownership rule is inert wherever no flag-bound gatherer works.
 */
function stampDropOwner(world: World, drop: Entity, harvester: Entity): void {
  if (world.has(harvester, WorkFlag)) world.add(drop, HarvestedBy, { by: harvester });
}

/**
 * Remove an exhausted {@link Resource} node (a mined deposit whose last unit was just chipped, or a bare
 * mushroom after its single pickup) and announce it (`resourceDepleted`) for audio/effects and the
 * collision-unblock seam. Unlike {@link fellNode} it leaves nothing behind — the yield already dropped as ore
 * piles / went onto the back — it just deletes the node so the planner never re-scans a spent deposit. The
 * node's cell is read before the destroy (the component object is dropped from its store by `world.destroy`).
 */
function depleteNode(world: World, ctx: SystemContext, node: Entity, goodType: number): void {
  const pos = world.get(node, Position);
  const at = eventAt(pos.x, pos.y);
  unstampResourceFootprint(world, node);
  world.destroy(node);
  ctx.events.emit({ kind: 'resourceDepleted', node, goodType, at });
}
