import {
  Crop,
  Felling,
  HarvestedBy,
  MineDeposit,
  Position,
  Resource,
  ResourceLayers,
  Settler,
  Stump,
  WorkFlag,
} from '../../../../../components/index.js';
import { eventAt } from '../../../../../core/events.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { stampResourceFootprintOrFallback, unstampResourceFootprint } from '../../../../footprint/index.js';
import { workRepeatsFor } from '../../../../progression/index.js';
import { addCarry } from './carry.js';
import { dropGroundPile } from './piles.js';

// Every mutation here conserves goods: what leaves a node is exactly what it drains.

/**
 * Units one completed `harvest` atomic yields. Approximation: a real per-good yield is not modeled yet.
 */
const HARVEST_YIELD = 1;

/**
 * Resolve one completed harvest swing. The node's marker components decide the shape, never its
 * goodType, so the lifecycle stays content-declared: a `Crop` field falls on the stroke that completes the
 * trade's count (approximation: which field action the count gates is not readable) and reaps its whole
 * yield to the ground, a `Felling` node drops a trunk on the chop that
 * zeroes `chopsLeft`, a `MineDeposit` chips ore piles until its last unit, and a bare node goes straight
 * onto the settler's back.
 *
 * `swings` is the whole work units the completed swing performs; a bare-node pluck stays one unit
 * because the pluck is itself the pickup. Returns the units extracted, the basis for per-unit work XP.
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
  if (res === undefined) return 0;
  // A shared carcass can re-arm to its next layer while a second hunter's atomic is in flight; minting
  // the stale good while draining the new layer would transmute goods.
  if (res.goodType !== goodType) return 0;
  if (world.has(node, Crop)) {
    if (res.remaining <= 0) return 0; // unripe: stands, and banks no stroke
    return strokeCompletesCount(world, ctx, settler, node, res, swings) ? reapField(world, node, res) : 0;
  }
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) {
    const chopsLeft = Math.max(0, felling.chopsLeft - swings);
    world.mut(node, Felling).chopsLeft = chopsLeft;
    if (chopsLeft > 0) return 0;
    fellNode(world, ctx, settler, node, res.goodType, res.remaining);
    return res.remaining;
  }
  // A competing collector took the last unit and its own drain already removed the node.
  if (res.remaining <= 0) return 0;
  const deposit = world.tryGet(node, MineDeposit);
  let took = Math.min(HARVEST_YIELD, res.remaining);
  if (deposit !== undefined) {
    // Observation: several strikes chip one unit, and the data pins only the single-swing cycle length.
    const advanced = deposit.strikes + swings;
    const freed = Math.floor(advanced / deposit.strikesPerUnit);
    const rest = advanced % deposit.strikesPerUnit;
    if (rest !== deposit.strikes) world.mut(node, MineDeposit).strikes = rest;
    if (freed === 0) return 0;
    took = Math.min(freed * HARVEST_YIELD, res.remaining);
    dropMinedOre(world, settler, node, res.goodType, took);
  } else {
    if (!strokeCompletesCount(world, ctx, settler, node, res, swings)) return 0;
    addCarry(world, settler, goodType, took);
  }
  // Decrement only after the unit is dropped or carried, so a rejecting `addCarry` cannot lose it.
  const remaining = res.remaining - took;
  world.mut(node, Resource).remaining = remaining;
  if (remaining <= 0) {
    depleteNode(world, ctx, node, res.goodType);
  } else if (world.has(node, MineDeposit)) {
    // A shrunk deposit must move from the map view's static decor layer to its live sprite pool.
    const pos = world.get(node, Position);
    ctx.events.emit({ kind: 'resourceMined', node, goodType: res.goodType, at: eventAt(pos.x, pos.y) });
  }
  return took;
}

/**
 * Bank a swing's `swings` strokes toward the trade's `baserepeatcounter` for the node's good, reporting
 * whether the count completed. Only the completing stroke frees a unit; earlier ones sit on the node's
 * counter, and on a node that stays standing a multi-unit stroke's overshoot carries into the next unit.
 */
function strokeCompletesCount(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  node: Entity,
  res: { readonly goodType: number; readonly strikes?: number | undefined },
  swings: number,
): boolean {
  const repeats = workRepeatsFor(ctx, world.tryGet(settler, Settler)?.jobType ?? null, res.goodType);
  if (repeats <= 1) return true;
  const advanced = (res.strikes ?? 0) + swings;
  if (advanced < repeats) {
    world.mut(node, Resource).strikes = advanced;
    return false;
  }
  const rest = advanced % repeats;
  const r = world.mut(node, Resource);
  if (rest === 0) r.strikes = undefined;
  else r.strikes = rest;
  return true;
}

/** Remove an exhausted resource node, unstamping its footprint through the incremental cache rather
 *  than a full overlay rebuild. */
function removeResourceNode(world: World, node: Entity): void {
  unstampResourceFootprint(world, node);
  world.destroy(node);
}

/**
 * Reap a ripe {@link Crop} field: drop its whole yield as a ground pile and remove the field, freeing the
 * tile to sow again. The field leaves no stump.
 */
function reapField(world: World, node: Entity, res: { goodType: number; remaining: number }): number {
  const { x, y } = world.get(node, Position);
  dropGroundPile(world, x, y, res.goodType, res.remaining);
  removeResourceNode(world, node);
  return res.remaining;
}

/**
 * Fell a {@link Felling} node whose last chop just landed: drop its whole yield as a ground trunk pile,
 * leave a {@link Stump} where it stood, and remove the node. `goodType` and `yieldAmount` are passed in
 * because `world.destroy` drops the component object from its store.
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
  const trunk = dropGroundPile(world, x, y, goodType, yieldAmount);
  markHarvestedBy(world, trunk, feller);
  // The stump is pure decor: non-blocking and not harvestable.
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
 * Drop the chipped units at the deposit's cell as a ground ore pile. The deposit itself stays standing
 * until its last unit is chipped.
 */
function dropMinedOre(world: World, miner: Entity, node: Entity, goodType: number, amount: number): void {
  const { x, y } = world.get(node, Position);
  const pile = dropGroundPile(world, x, y, goodType, amount);
  markHarvestedBy(world, pile, miner);
}

/**
 * Name the gatherer behind a fresh ground drop, but only when it carries a {@link WorkFlag}: that is what
 * lets a flag-bound gatherer later reclaim its own drop and leave every other pile alone.
 */
function markHarvestedBy(world: World, drop: Entity, harvester: Entity): void {
  if (world.has(harvester, WorkFlag)) world.add(drop, HarvestedBy, { by: harvester });
}

/**
 * Remove an exhausted {@link Resource} node and announce it. Unlike {@link fellNode} it leaves nothing
 * behind: the yield already dropped as piles or went onto a settler's back.
 *
 * A node with buried {@link ResourceLayers} is not spent: the drained good re-arms as the head layer on
 * the same body and cell, and only the last layer's drain removes the node. Decals differ per good, so
 * each stage re-stamps the footprint.
 */
function depleteNode(world: World, ctx: SystemContext, node: Entity, goodType: number): void {
  const buried = world.tryGet(node, ResourceLayers);
  const layer = buried?.layers[0];
  if (buried !== undefined && layer !== undefined) {
    unstampResourceFootprint(world, node);
    const r = world.mut(node, Resource);
    const atomicChanged = r.harvestAtomic !== layer.harvestAtomic;
    r.goodType = layer.goodType;
    r.remaining = layer.amount;
    r.harvestAtomic = layer.harvestAtomic;
    r.gfxIndex = layer.gfxIndex;
    r.strikes = undefined;
    // The resource region index captures a node's harvest atomic on membership changes only; a re-add
    // journals the new one.
    if (atomicChanged) world.add(node, Resource, { ...r });
    if (buried.layers.length === 1) world.remove(node, ResourceLayers);
    else world.mut(node, ResourceLayers).layers.shift();
    stampResourceFootprintOrFallback(world, ctx.content, node, layer.goodType);
    return;
  }
  const pos = world.get(node, Position);
  const at = eventAt(pos.x, pos.y);
  removeResourceNode(world, node);
  ctx.events.emit({ kind: 'resourceDepleted', node, goodType, at });
}
