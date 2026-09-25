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
import { toolWorkFactorPct } from '../../../../equipment/index.js';
import { stampResourceFootprintOrFallback, unstampResourceFootprint } from '../../../../footprint/index.js';
import { jobExperiencePercent, strokesPerUnit, workRepeatsFor } from '../../../../progression/index.js';
import { addCarry } from './carry.js';
import { dropGroundPile } from './piles.js';

// Every mutation here conserves goods: what leaves a node is exactly what it drains.

/**
 * Units one completed `harvest` atomic yields. Approximation: a real per-good yield is not modeled yet.
 */
const HARVEST_YIELD = 1;

/** Strokes a pickup clip spends on a unit: it takes the unit outright. Original behavior. */
export const PICKUP_STROKES_PER_UNIT = 1;

/**
 * Strokes one unit of `goodType` costs `settler` on a stroke-counted clip: the trade's track count, cut by
 * the worker's experience and tool. Re-read at every stroke, so training or a tool picked up mid-unit
 * counts at once. Original behavior.
 */
export function harvestStrokesPerUnit(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  goodType: number,
): number {
  return strokesPerUnit(
    workRepeatsFor(ctx, world.tryGet(settler, Settler)?.jobType ?? null, goodType),
    jobExperiencePercent(world, ctx, settler, goodType),
    toolWorkFactorPct(world, ctx, settler),
  );
}

/**
 * Resolve one landed harvest stroke. The node's marker components decide the shape, never its goodType,
 * so the lifecycle stays content-declared: a `Crop` field is reaped whole to the ground, a `Felling` node
 * drops its whole yield as a trunk, a `MineDeposit` chips one ore pile until its last unit, and a bare node
 * goes straight onto the settler's back. Each completes on the stroke that brings the node's landed count
 * to `strokesNeeded`, the count then starting again for the next unit.
 *
 * Returns the units extracted; zero while the unit is still being worked.
 */
export function harvestFromNode(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  node: Entity,
  goodType: number,
  strokesNeeded: number,
): number {
  const res = world.tryGet(node, Resource);
  if (res === undefined) return 0;
  // A shared carcass can re-arm to its next layer while a second hunter's atomic is in flight; minting
  // the stale good while draining the new layer would transmute goods.
  if (res.goodType !== goodType) return 0;
  if (world.has(node, Crop)) {
    if (res.remaining <= 0) return 0; // unripe: stands, and banks no stroke
    return strokeCompletesUnit(world, node, res.strikes, strokesNeeded) ? reapField(world, node, res) : 0;
  }
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) {
    if (felling.chops + 1 < strokesNeeded) {
      world.mut(node, Felling).chops = felling.chops + 1;
      return 0;
    }
    fellNode(world, ctx, settler, node, res.goodType, res.remaining);
    return res.remaining;
  }
  // A competing collector took the last unit and its own drain already removed the node.
  if (res.remaining <= 0) return 0;
  const deposit = world.tryGet(node, MineDeposit);
  const took = Math.min(HARVEST_YIELD, res.remaining);
  if (deposit !== undefined) {
    if (deposit.strikes + 1 < strokesNeeded) {
      world.mut(node, MineDeposit).strikes = deposit.strikes + 1;
      return 0;
    }
    if (deposit.strikes !== 0) world.mut(node, MineDeposit).strikes = 0;
    dropMinedOre(world, settler, node, res.goodType, took);
  } else {
    if (!strokeCompletesUnit(world, node, res.strikes, strokesNeeded)) return 0;
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

/** Land one stroke on a field's or bare node's `Resource.strikes`, reporting whether it completes the unit;
 *  the completing stroke clears the count. */
function strokeCompletesUnit(
  world: World,
  node: Entity,
  landed: number | undefined,
  needed: number,
): boolean {
  const next = (landed ?? 0) + 1;
  if (next < needed) {
    world.mut(node, Resource).strikes = next;
    return false;
  }
  if (landed !== undefined) world.mut(node, Resource).strikes = undefined;
  return true;
}

/**
 * Whether the stroke that just resolved left the node's unit part-worked. The executor then chains the
 * next stroke directly: the original plays a gatherer's strokes back to back, with no rest between them.
 */
export function continuesHarvest(world: World, node: Entity): boolean {
  const res = world.tryGet(node, Resource);
  if (res === undefined) return false;
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) return felling.chops > 0;
  const deposit = world.tryGet(node, MineDeposit);
  if (deposit !== undefined) return deposit.strikes > 0;
  return (res.strikes ?? 0) > 0;
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
 * Fell a {@link Felling} node whose completing stroke just landed: drop its whole yield as a ground trunk pile,
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
