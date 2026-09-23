import { Carrying, Position } from '../../../../../components/index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../../nav/terrain/index.js';
import { spillOverRings, stackOntoTile } from './piles.js';

/**
 * Add `amount` of `goodType` to a settler's carried load, merging into an existing load of that good.
 * {@link Carrying} is single-slot, so picking up a different good while loaded would overwrite and destroy
 * the held one. That can only be a planner bug, so it throws rather than break goods conservation.
 */
export function addCarry(world: World, settler: Entity, goodType: number, amount: number): void {
  const held = world.tryMut(settler, Carrying);
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

/** Shrink a carried load by `by` units, removing the {@link Carrying} entirely when that empties it. */
export function shrinkCarry(
  world: World,
  settler: Entity,
  load: { readonly amount: number },
  by: number,
): void {
  if (load.amount > by) world.mut(settler, Carrying).amount -= by;
  else world.remove(settler, Carrying);
}

/**
 * Drop a settler's carried load onto a loose ground heap on the tile it stands on, up to the per-tile stack
 * cap; any remainder stays on its back and the next drop physically walks it on. The heap snaps to the
 * settler's half-cell node ({@link positionOfNode}), not its fractional Position, so every drop on a node
 * stacks onto the same heap. Returns the units set down, 0 when the tile is full or holds a different good.
 */
export function dropCarryAtOwnTile(world: World, settler: Entity): number {
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return 0;
  const pos = world.tryGet(settler, Position);
  if (pos === undefined) return 0;
  const node = nodeOfPosition(pos.x, pos.y);
  const at = positionOfNode(node.hx, node.hy);
  const placed = stackOntoTile(world, at.x, at.y, load.goodType, load.amount);
  if (placed > 0) shrinkCarry(world, settler, load, placed);
  return placed;
}

/**
 * Force a settler's whole carried load onto the ground, unlike {@link dropCarryAtOwnTile} which leaves any
 * tile overflow on the back: its own tile first, then the remainder scattered over the nearest tiles. What
 * the scatter cannot place stays carried. Returns the units that reached the ground; without terrain there
 * is no scatter, only the own tile.
 */
export function dropCarriedLoad(world: World, terrain: TerrainGraph | undefined, settler: Entity): number {
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return 0;
  const pos = world.tryGet(settler, Position);
  if (pos === undefined) return 0;

  const total = dropCarryAtOwnTile(world, settler);
  const left = world.tryGet(settler, Carrying);
  if (terrain === undefined || left === undefined) return total;
  const start = nodeOfPosition(pos.x, pos.y);
  const spilled = spillOverRings(
    world,
    terrain,
    terrain.nodeAtClamped(start.hx, start.hy),
    left.goodType,
    left.amount,
  );
  if (spilled > 0) shrinkCarry(world, settler, left, spilled);
  return total + spilled;
}
