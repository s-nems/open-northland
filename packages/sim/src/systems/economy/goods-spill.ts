import {
  Equipment,
  type GoodsLine,
  Position,
  Stockpile,
  stockpileEntries,
  Upgrading,
} from '../../components/index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { isUsed, spillOverRings } from '../settlers/atomics/effects/goods/index.js';

// What a destroy leaves behind, in two steps around it: read what the entity holds while it still
// stands, then heap it on the ground where it stood. Both producers (a razed store's stock, a fallen
// character's gear) feed the one scatter. A building's order is forced - the heaps land on its own
// cells, which stay walk-blocked until it is gone.

/** The contents a destroy spills, and the tile it spills onto. */
export interface SpilledStock {
  readonly x: Fixed;
  readonly y: Fixed;
  /** Canonical ascending-goodType lines, all with `amount > 0`. */
  readonly goods: readonly GoodsLine[];
}

/** The spill for a tile and a good tally, or null for an empty tally. */
function spillOf(
  pos: { readonly x: Fixed; readonly y: Fixed },
  held: Map<number, number>,
): SpilledStock | null {
  if (held.size === 0) return null;
  const goods = stockpileEntries({ amounts: held }).map(([goodType, amount]) => ({ goodType, amount }));
  return { x: pos.x, y: pos.y, goods };
}

/**
 * Everything inside `store` that should end up on the ground when it is destroyed: its {@link Stockpile},
 * plus an upgrading building's stashed pre-upgrade inventory ({@link Upgrading} holds the real inventory
 * aside while the live stockpile serves as the build hold, so a store razed mid-upgrade would otherwise
 * drop only half of what it held). Null when it stood nowhere or held nothing. Call it before the destroy.
 */
export function spilledStockOf(world: World, store: Entity): SpilledStock | null {
  const pos = world.tryGet(store, Position);
  if (pos === undefined) return null; // a position-less fixture store: no tile to heap onto
  const held = new Map<number, number>();
  const add = (goodType: number, amount: number): void => {
    if (amount > 0) held.set(goodType, (held.get(goodType) ?? 0) + amount);
  };
  const stock = world.tryGet(store, Stockpile);
  if (stock !== undefined) for (const [goodType, amount] of stock.amounts) add(goodType, amount);
  const upgrading = world.tryGet(store, Upgrading);
  if (upgrading !== undefined) for (const [good, amount] of upgrading.savedStock) add(good, amount);
  return spillOf(pos, held);
}

/**
 * The gear a fallen character leaves beside its bones: one unit per equipment slot holding an unused
 * good. A part-used unit drops nothing - the take-off rule ({@link isUsed}). Null when it wore nothing
 * droppable or stood nowhere. Call it before the destroy.
 *
 * Approximation: `misc.ini` `[tribelandscapeLinkData]` leaves a human death only the `skeleton` decal
 * and keeps the goods-bearing cadaver for the animal tribes. A carried load is not part of the rule.
 */
export function droppedEquipmentOf(world: World, character: Entity): SpilledStock | null {
  const pos = world.tryGet(character, Position);
  const equipment = world.tryGet(character, Equipment);
  if (pos === undefined || equipment === undefined) return null;
  const held = new Map<number, number>();
  const slots = [equipment.weapon, equipment.armor, equipment.boots, equipment.tool, ...equipment.misc];
  for (const slot of slots) {
    if (slot === null || isUsed(slot)) continue;
    held.set(slot.goodType, (held.get(slot.goodType) ?? 0) + 1);
  }
  return spillOf(pos, held);
}

/**
 * Heap a spill on the ground where it fell - each good scattered outward from its tile
 * ({@link spillOverRings}) in canonical ascending-goodType order, so a full warehouse comes down as a
 * broad field of heaps its porters then haul back in. Call it after the destroy. A no-op without a map.
 *
 * Only tiles a fetcher could actually work are used: nothing standing (walls, trees, deposits) and the
 * spill tile's own walk component, so no heap is stranded under a wall or across a river. Whatever finds
 * no tile inside {@link spillOverRings}'s radius is lost - a sealed-in ruin on a tiny island can swallow
 * the tail of a very large store, the one place this rule does not conserve goods.
 */
export function scatterSpilledStock(world: World, ctx: SystemContext, spill: SpilledStock | null): void {
  const terrain = ctx.terrain;
  if (spill === null || terrain === undefined) return;
  const n = nodeOfPosition(spill.x, spill.y);
  const from = terrain.nodeAtClamped(n.hx, n.hy);
  const component = terrain.componentOf(from);
  if (component < 0) return; // an unwalkable origin matches no tile: the ring walk could place nothing
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const usable = (node: NodeId): boolean => !blocked.has(node) && terrain.componentOf(node) === component;
  for (const line of spill.goods) {
    spillOverRings(world, terrain, from, line.goodType, line.amount, usable);
  }
}
