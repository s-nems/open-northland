import {
  Crop,
  Felling,
  HarvestedBy,
  MineDeposit,
  ownerOf,
  Position,
  Resource,
  ResourceLayers,
  Settler,
  Stump,
  stampOwner,
  WorkFlag,
} from '../../../../../components/index.js';
import { eventAt } from '../../../../../core/events.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { stampResourceFootprintOrFallback, unstampResourceFootprint } from '../../../../footprint/index.js';
import { workRepeatsFor } from '../../../../progression/index.js';
import { addCarry } from './carry.js';
import { dropGroundPile } from './piles.js';

// The harvest effect: resolve one completed swing against a resource node — reap a field, chop a tree,
// chip a mined deposit, or pluck a bare node — and the felled-trunk / ore-pile / depletion drops that
// follow. Every mutation conserves goods.

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
 *
 * `swings` is the whole work units the completed swing performs ({@link swingWorkUnits} — 1 for a
 * novice, up to 2 at gather mastery): a chop drives a {@link Felling} tree that many steps, a strike
 * advances a {@link MineDeposit} that many counts (chipping more than one unit when they complete). A
 * bare-node pluck stays one unit regardless — the pluck IS the pickup and the on-foot carry holds one.
 *
 * Returns the units this swing actually extracted (the trunk/sheaf's whole yield on the swing that
 * fells/reaps, the chipped/plucked unit(s), 0 for a mid-job chop or strike), the executor's basis for
 * per-unit work XP.
 */
export function harvestFromNode(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  node: Entity,
  goodType: number,
  swings = 1,
): number {
  const res = world.tryGet(node, Resource);
  if (res === undefined) return 0; // node already felled/gone — the swing struck nothing (conserved)
  // A swing planned against a good the node no longer holds hit air: a shared carcass can re-arm to its
  // next layer (`depleteNode`) while a second hunter's atomic is in flight, and minting the STALE good
  // while draining the new layer would transmute goods. Yield nothing; the raced hunter re-plans.
  if (res.goodType !== goodType) return 0;
  if (world.has(node, Crop)) {
    return reapField(world, node, res);
  }
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) {
    const chopsLeft = Math.max(0, felling.chopsLeft - swings);
    world.write(node, Felling, (f) => {
      f.chopsLeft = chopsLeft;
    });
    if (chopsLeft > 0) return 0; // a mid-job chop extracts nothing yet
    fellNode(world, ctx, settler, node, res.goodType, res.remaining);
    return res.remaining;
  }
  // A node emptied since the planner chose it (a competing collector took its last unit): nothing left
  // to give, so conserve goods and don't re-remove it (its own drain already removed it).
  if (res.remaining <= 0) return 0;
  const deposit = world.tryGet(node, MineDeposit);
  let took = Math.min(HARVEST_YIELD, res.remaining);
  if (deposit !== undefined) {
    // Several strikes chip one unit (observed calibration, see MineDeposit doc — the data pins only the
    // single-swing cycle length): only the strike that completes a unit drops ore and drains the node;
    // earlier strikes just advance the counter. A legacy 1-strike deposit never touches the counter, so its
    // unstamped component shape (hash) survives being worked — the guarantee `createResourceNode`'s conditional
    // stamp promises.
    const strikesPerUnit = deposit.strikesPerUnit ?? 1;
    if (strikesPerUnit > 1) {
      const advanced = (deposit.strikes ?? 0) + swings;
      const freed = Math.floor(advanced / strikesPerUnit);
      world.write(node, MineDeposit, (d) => {
        d.strikes = advanced % strikesPerUnit;
      });
      if (freed === 0) return 0;
      took = Math.min(freed * HARVEST_YIELD, res.remaining);
    } else {
      took = Math.min(swings * HARVEST_YIELD, res.remaining);
    }
    dropMinedOre(world, settler, node, res.goodType, took); // an ore pile at the deposit's cell, carried off later
  } else {
    // A bare-node pluck whose trade plays several strokes per unit (`workRepeatsFor` - the extracted
    // `baserepeatcounter`; the hunter's carcass): only the stroke that completes the count plucks the
    // unit, earlier ones bank on the node's counter. Mastery frees units in fewer strokes through
    // `swings` (the same fewer-swings rule the deposits ride). Single-stroke trades skip the counter.
    const repeats = workRepeatsFor(ctx, world.tryGet(settler, Settler)?.jobType ?? null, res.goodType);
    if (repeats > 1) {
      const advanced = (res.strikes ?? 0) + swings;
      if (advanced < repeats) {
        world.write(node, Resource, (r) => {
          r.strikes = advanced;
        });
        return 0; // a mid-unit stroke extracts nothing yet
      }
      const rest = advanced % repeats; // a mastered stroke's overshoot carries into the next unit
      world.write(node, Resource, (r) => {
        if (rest === 0) delete r.strikes;
        else r.strikes = rest;
      });
    }
    addCarry(world, settler, goodType, took); // the pluck IS the pickup - straight onto the back
  }
  // Decrement only after the unit is safely dropped/carried: were `addCarry` ever to reject (a full load), the
  // unit is not lost and the node isn't wrongly depleted. The planner only reaches a harvest empty-handed, so
  // `addCarry` never throws today; this keeps the throw-safe ordering anyway.
  const remaining = res.remaining - took;
  world.write(node, Resource, (r) => {
    r.remaining = remaining;
  });
  if (remaining <= 0) {
    depleteNode(world, ctx, node, res.goodType); // last unit chipped — the node is gone
  } else if (world.has(node, MineDeposit)) {
    // A surviving deposit shrank a unit — announce it (`resourceMined`) so the map view hands the node
    // from its static decor layer to the live sprite pool (and audio can hook a chip effect).
    const pos = world.get(node, Position);
    ctx.events.emit({ kind: 'resourceMined', node, goodType: res.goodType, at: eventAt(pos.x, pos.y) });
  }
  return took;
}

/** Remove an exhausted resource node, dropping its footprint stamp first (through the incremental cache,
 *  never a full overlay rebuild) so the planner never re-scans a node that no longer exists. */
function removeResourceNode(world: World, node: Entity): void {
  unstampResourceFootprint(world, node);
  world.destroy(node);
}

/**
 * Reap a ripe {@link Crop} field: drop its whole yield (`Resource.remaining`, set by the CropGrowthSystem at
 * ripeness) at its node as a ground sheaf pile — the same {@link GroundDrop} shape a felled trunk takes, so the
 * farmer's pickup + the porter/delivery machinery carry it off unchanged (it draws the good's
 * `landscapeToPickup` "cut wheat" look) — and remove the field, freeing the tile to sow again. An unripe field
 * (`remaining <= 0`) yields nothing and stays standing (goods conserved). The sheaf inherits the FARM's
 * {@link Owner} (via the field's {@link Crop} link), not the reaping farmer's — the farm's own farmers are the
 * same player so they still collect it, while the gated porter/gatherer scans keep a rival's hauler off it.
 * No stump — the field clears to bare ground, faithful to the original's wheat cycle. Returns the units reaped
 * (the whole yield, or 0 for stubble).
 */
function reapField(world: World, node: Entity, res: { goodType: number; remaining: number }): number {
  if (res.remaining <= 0) return 0; // unripe / raced — the swing cut stubble (nothing conjured)
  const { x, y } = world.get(node, Position);
  const sheaf = dropGroundPile(world, x, y, res.goodType, res.remaining);
  const farm = world.tryGet(node, Crop)?.farm;
  if (farm !== undefined) stampOwner(world, sheaf, ownerOf(world, farm));
  removeResourceNode(world, node);
  return res.remaining;
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
  removeResourceNode(world, node);
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
 * Mark a fresh ground drop with its harvester's identity and player. Two orthogonal stamps:
 *  - {@link HarvestedBy} names the exact gatherer, but only when it is FLAG-BOUND (carries a {@link WorkFlag}) —
 *    what lets that gatherer later reclaim only its own trunk/ore and leave every other pile alone. A flagless
 *    collector marks nothing here, so its drop hashes and is collected as normal.
 *  - {@link Owner} is the harvester's PLAYER (via {@link stampOwner}) — so the pile stays on its own side and a
 *    rival player's hauler cannot fetch it (the same-side rule).
 */
function stampDropOwner(world: World, drop: Entity, harvester: Entity): void {
  if (world.has(harvester, WorkFlag)) world.add(drop, HarvestedBy, { by: harvester });
  stampOwner(world, drop, ownerOf(world, harvester));
}

/**
 * Remove an exhausted {@link Resource} node (a mined deposit whose last unit was just chipped, or a bare
 * mushroom after its single pickup) and announce it (`resourceDepleted`) for audio/effects and the
 * collision-unblock seam. Unlike {@link fellNode} it leaves nothing behind — the yield already dropped as ore
 * piles / went onto the back — it just deletes the node so the planner never re-scans a spent deposit. The
 * node's cell is read before the destroy (the component object is dropped from its store by `world.destroy`).
 *
 * A node with buried {@link ResourceLayers} (a hunter's multi-good carcass) is not spent yet: the drained
 * good re-arms as the head layer instead - same body, same cell, the next good and its stage decal - and
 * only the last layer's drain removes it. The footprint is re-stamped per stage (decals differ per good).
 */
function depleteNode(world: World, ctx: SystemContext, node: Entity, goodType: number): void {
  const buried = world.tryGet(node, ResourceLayers);
  const layer = buried?.layers[0];
  if (buried !== undefined && layer !== undefined) {
    unstampResourceFootprint(world, node);
    world.write(node, Resource, (r) => {
      r.goodType = layer.goodType;
      r.remaining = layer.amount;
      r.harvestAtomic = layer.harvestAtomic;
      if (layer.gfxIndex !== undefined) r.gfxIndex = layer.gfxIndex;
      else delete r.gfxIndex;
      delete r.strikes; // a fresh good starts its stroke count over
    });
    if (buried.layers.length === 1) world.remove(node, ResourceLayers);
    else world.write(node, ResourceLayers, (l) => l.layers.shift());
    stampResourceFootprintOrFallback(world, ctx.content, node, layer.goodType);
    return;
  }
  const pos = world.get(node, Position);
  const at = eventAt(pos.x, pos.y);
  removeResourceNode(world, node);
  ctx.events.emit({ kind: 'resourceDepleted', node, goodType, at });
}
