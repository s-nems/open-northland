import { Carrying, Position } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../nav/halfcell.js';
import { stackOntoTile } from './piles.js';

// A settler's carried load (single-slot {@link Carrying}): add to it, shrink it, or set it down on the
// tile the settler stands on. The shared load primitives the harvest, store-transfer, and consume
// effects build on.

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

/** Shrink a settler's carried load by `by` units, removing the {@link Carrying} entirely when that
 *  empties it — the shared decrement-or-remove step of eating a carried unit and unloading a pile. */
export function shrinkCarry(world: World, settler: Entity, load: { amount: number }, by: number): void {
  if (load.amount > by) load.amount -= by;
  else world.remove(settler, Carrying);
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
