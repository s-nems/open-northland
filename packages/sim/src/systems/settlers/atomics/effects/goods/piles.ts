import {
  Building,
  GroundDrop,
  Position,
  Stockpile,
  setStockAmount,
  Vehicle,
} from '../../../../../components/index.js';
import type { Fixed } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../../nav/terrain/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../../spatial/metric.js';
import { stockpilesAtNode } from '../../../../spatial/stockpiles.js';
import { isYardHeap, lowestStockedGood, MAX_GROUND_STACK } from '../../../../stores/index.js';

/**
 * Create a haulable ground pile: a {@link Stockpile} plus {@link Position} plus {@link GroundDrop}. The
 * {@link GroundDrop} marker is what the pickup, porter, and delivery machinery keys off, so every drop
 * site assembles the shape here rather than by hand.
 */
export function dropGroundPile(world: World, x: Fixed, y: Fixed, goodType: number, amount: number): Entity {
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[goodType, amount]]) });
  world.add(pile, GroundDrop, { goodType });
  return pile;
}

/**
 * Drop `amount` of `goodType` as a loose ground pile, stacking onto an existing loose pile of the same
 * good on that tile up to {@link MAX_GROUND_STACK}. A loose pile carries no {@link GroundDrop} or
 * {@link Building} marker, so it is neither a pickup source nor a delivery sink and simply rests there.
 *
 * The pile to stack onto is the first match in ascending id order, a which-entity-wins pick that must be
 * canonical. A heap of a different good is left alone, so no good is ever overwritten.
 */
export function dropOrStackGood(world: World, x: Fixed, y: Fixed, goodType: number, amount: number): Entity {
  const at = nodeOfPosition(x, y);
  for (const e of stockpilesAtNode(world, at.hx, at.hy)) {
    if (world.has(e, GroundDrop) || world.has(e, Building)) continue;
    const stock = world.get(e, Stockpile); // indexed on (Stockpile, Position), so both are present
    const pos = world.get(e, Position);
    if (pos.x !== x || pos.y !== y) continue; // the same node, a different exact Position
    const have = stock.amounts.get(goodType) ?? 0;
    if (have <= 0 && stock.amounts.size > 0) continue;
    setStockAmount(world, e, goodType, Math.min(MAX_GROUND_STACK, have + amount));
    return e;
  }
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[goodType, Math.min(MAX_GROUND_STACK, amount)]]) });
  return pile;
}

/**
 * Stack up to `want` units of `good` onto the yard heap at exactly `(x, y)`, capped at
 * {@link MAX_GROUND_STACK}, creating the heap when none is there yet. Returns how many units were placed,
 * which is 0 when the tile is full or holds a different good; the caller carries the remainder onward.
 * This is the overflow-reporting twin of {@link dropOrStackGood}, which silently drops the remainder.
 *
 * The heap to stack onto is the first match in ascending id order, a which-entity-wins pick that must be
 * canonical. Ground goods belong to nobody, so a heap is never owner-stamped.
 */
export function stackOntoTile(world: World, x: Fixed, y: Fixed, good: number, want: number): number {
  if (want <= 0) return 0;
  const at = nodeOfPosition(x, y);
  for (const e of stockpilesAtNode(world, at.hx, at.hy)) {
    if (!isYardHeap(world, e)) continue;
    const stock = world.get(e, Stockpile);
    const pos = world.get(e, Position);
    if (pos.x !== x || pos.y !== y) continue; // the same node, a different exact Position
    // Testing the stocked good rather than `amounts.size` keeps a re-fill from livelocking against a
    // heap of our own good that a porter drained to zero and nothing has reaped yet.
    const other = lowestStockedGood(stock);
    if (other !== null && other !== good) return 0;
    const have = stock.amounts.get(good) ?? 0;
    const placed = Math.min(MAX_GROUND_STACK - have, want);
    if (placed <= 0) return 0;
    setStockAmount(world, e, good, have + placed);
    return placed;
  }
  const placed = Math.min(MAX_GROUND_STACK, want);
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[good, placed]]) });
  return placed;
}

/**
 * Set one unit of `good` down at exactly `(x, y)` without ever losing it, starting a second heap when the
 * tile's own heap is full or holds another good. Two heaps on one tile is a supported state, so this
 * trades a cosmetic overlap for goods conservation. A multi-unit set-down belongs in
 * {@link spillOverRings}.
 */
export function placeUnitOnTile(world: World, x: Fixed, y: Fixed, good: number): void {
  if (stackOntoTile(world, x, y, good, 1) > 0) return;
  const pile = world.create();
  world.add(pile, Position, { x, y });
  world.add(pile, Stockpile, { amounts: new Map([[good, 1]]) });
}

/**
 * Greatest Manhattan ring radius in half-cell nodes {@link spillOverRings} walks before giving up.
 * Approximation: the original's drop-scatter extent is unknown.
 */
const SPILL_MAX_RADIUS = 32;

/**
 * Scatter `amount` units of `good` onto the ground around `from`, nearest tile first, skipping unwalkable
 * tiles, tiles holding a different good, and whatever `accept` rejects. Returns how many units reached the
 * ground, short of `amount` only when every tile within the bound is saturated.
 *
 * Rings expand outward and each ring's tiles are visited in ascending {@link NodeId} order, a canonical
 * which-tile-wins pick.
 */
export function spillOverRings(
  world: World,
  terrain: TerrainGraph,
  from: NodeId,
  good: number,
  amount: number,
  accept?: (node: NodeId) => boolean,
): number {
  let left = amount;
  const { x: cx, y: cy } = terrain.coordsOf(from);
  // Refilled per ring and fully spilled before the next one, so one buffer serves the whole walk.
  const ring: NodeId[] = [];
  for (let r = 0; r <= SPILL_MAX_RADIUS && left > 0; r++) {
    ring.length = 0;
    const offsets = ringOffsetCount(r);
    for (let i = 0; i < offsets; i++) {
      const node = terrain.nodeAtClamped(cx + ringOffsetDx(r, i), cy + ringOffsetDy(r, i));
      if (!terrain.isWalkable(node)) continue;
      if (accept !== undefined && !accept(node)) continue;
      ring.push(node);
    }
    ring.sort((a, b) => a - b); // canonical ascending-NodeId placement order
    for (const node of ring) {
      if (left <= 0) break;
      const c = terrain.coordsOf(node);
      const at = positionOfNode(c.x, c.y);
      left -= stackOntoTile(world, at.x, at.y, good, left);
    }
  }
  return amount - left;
}

/**
 * Destroy a loose ground pile a pickup or a bite just emptied, so a long game does not accrete a dead heap
 * per felled tree or delivered load. A lingering zero heap would mis-render as a flag and read as free but
 * unfillable to the yard scan. A {@link Building} warehouse and a {@link Vehicle} hull are persistent
 * stores and keep their empty stock. Iterating `amounts` is order-independent because the test is a pure
 * "holds nothing" predicate.
 */
export function reapEmptyLoosePile(world: World, pile: Entity): void {
  if (world.has(pile, Building) || world.has(pile, Vehicle)) return;
  const stock = world.tryGet(pile, Stockpile);
  if (stock === undefined) return;
  for (const amount of stock.amounts.values()) if (amount > 0) return;
  world.destroy(pile);
}
