import { BUILDING_KIND, type ContentSet } from '@open-northland/data';
import {
  Building,
  Carrying,
  Equipment,
  type GoodsLine,
  isScriptedEconomySeat,
  ownerOf,
  Position,
  Settler,
  Stockpile,
  stockpileEntries,
  Upgrading,
  wornSlot,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { NEAREST_NODE_SEARCH_CAP } from '../../nav/nearest.js';
import { ringSearch } from '../../nav/ring-search.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../context.js';
import { isWornAtMost } from '../equipment/index.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { isSoldierJob } from '../readviews/index.js';
import { isUsed, spillOverRings } from '../settlers/atomics/effects/goods/index.js';

// What a destroy leaves behind, in two steps around it: read what the entity holds while it still stands,
// then heap it on the ground where it stood. The order is forced for a building, whose heaps land on its
// own cells, which stay walk-blocked until it is gone.

/** The contents a destroy spills, and the tile it spills onto. */
export interface SpilledStock {
  readonly x: Fixed;
  readonly y: Fixed;
  /** Canonical ascending-goodType lines, all with `amount > 0`. */
  readonly goods: readonly GoodsLine[];
  /** How far out the heaps may land, in {@link spillOverRings} rings; omitted for the default extent. */
  readonly maxRadius?: number;
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
 * an upgrading building's stashed pre-upgrade inventory, which {@link Upgrading} holds aside, and any
 * `salvage` from the structure itself. Call it before the destroy.
 */
export function spilledStockOf(
  world: World,
  store: Entity,
  salvage: readonly GoodsLine[] = [],
): SpilledStock | null {
  const pos = world.tryGet(store, Position);
  if (pos === undefined) return null;
  const held = heldStockOf(world, store);
  for (const line of salvage) addTo(held, line.goodType, line.amount);
  return spillOf(pos, held);
}

/**
 * {@link spilledStockOf} for a razed building, which a map-scripted seat's building empties differently.
 * Original behavior: such a seat's warehouse or training house keeps its contents, a warehouse leaving
 * {@link SCRIPTED_WAREHOUSE_RATION} of plain food instead, and its other buildings spill at most
 * {@link SCRIPTED_SLOT_SPILL_CAP} of each good. The original applies this to every machine seat; here a
 * seat the computer player keeps spills like a human's (owner ruling).
 */
export function razedStockOf(
  world: World,
  ctx: ContentContext,
  building: Entity,
  salvage: readonly GoodsLine[],
): SpilledStock | null {
  const owner = ownerOf(world, building);
  const pos = world.tryGet(building, Position);
  if (owner === undefined || pos === undefined || !isScriptedEconomySeat(world, owner)) {
    return spilledStockOf(world, building, salvage);
  }
  const index = contentIndex(ctx.content);
  const kind = index.buildings.get(world.get(building, Building).buildingType)?.kind;
  const held = new Map<number, number>();
  if (kind === BUILDING_KIND.storage) {
    const food = index.goodTypeBySlug.get(SCRIPTED_WAREHOUSE_RATION.good);
    if (food !== undefined) addTo(held, food, SCRIPTED_WAREHOUSE_RATION.amount);
  } else if (kind !== BUILDING_KIND.training) {
    for (const [good, amount] of heldStockOf(world, building)) {
      addTo(held, good, Math.min(amount, SCRIPTED_SLOT_SPILL_CAP));
    }
  }
  for (const line of salvage) addTo(held, line.goodType, line.amount);
  return spillOf(pos, held);
}

/** The most of one good a map-scripted seat's razed building spills. Original behavior. */
export const SCRIPTED_SLOT_SPILL_CAP = 25;
/** What a map-scripted seat's razed warehouse leaves in place of its contents. Original behavior. */
export const SCRIPTED_WAREHOUSE_RATION = { good: 'food_simple', amount: 25 } as const;

/** A store's own stock plus an upgrading building's stashed inventory, by good. */
function heldStockOf(world: World, store: Entity): Map<number, number> {
  const held = new Map<number, number>();
  const stock = world.tryGet(store, Stockpile);
  if (stock !== undefined) for (const [goodType, amount] of stock.amounts) addTo(held, goodType, amount);
  const upgrading = world.tryGet(store, Upgrading);
  if (upgrading !== undefined) for (const [good, amount] of upgrading.savedStock) addTo(held, good, amount);
  return held;
}

function addTo(held: Map<number, number>, goodType: number, amount: number): void {
  if (amount > 0) held.set(goodType, (held.get(goodType) ?? 0) + amount);
}

/**
 * What a fallen character leaves beside its bones: its carried load, shoes and a tool still at least 90%
 * whole, and every other slot holding an unused good, one unit each. Original behavior: only a soldier
 * drops his weapon, so a hero's class weapon dies with him. Call it before the destroy.
 *
 * Approximation: `misc.ini` `[tribelandscapeLinkData]` leaves a human death only the `skeleton` decal
 * and keeps the goods-bearing cadaver for the animal tribes.
 */
export function droppedOnDeathOf(world: World, content: ContentSet, character: Entity): SpilledStock | null {
  const pos = world.tryGet(character, Position);
  if (pos === undefined) return null;
  const held = new Map<number, number>();
  const add = (goodType: number, amount: number): void => {
    held.set(goodType, (held.get(goodType) ?? 0) + amount);
  };
  const load = world.tryGet(character, Carrying);
  if (load !== undefined && load.amount > 0) add(load.goodType, load.amount);
  const equipment = world.tryGet(character, Equipment);
  if (equipment !== undefined) {
    const boots = wornSlot(world, character, 'boots', 0);
    for (const slot of [boots, equipment.tool]) {
      if (slot !== null && isWornAtMost(content, slot, DROPS_AS_NEW_WEAR_DIVISOR)) add(slot.goodType, 1);
    }
    const soldier = isSoldierJob(content, world.tryGet(character, Settler)?.jobType ?? null);
    for (const slot of [soldier ? equipment.weapon : null, equipment.armor, ...equipment.misc]) {
      if (slot !== null && !isUsed(slot)) add(slot.goodType, 1);
    }
  }
  return spillOf(pos, held);
}

/** Original behavior: shoes or a tool worn by at most a tenth of its condition drops as a new good. */
const DROPS_AS_NEW_WEAR_DIVISOR = 10;

/**
 * Heap a spill on the ground where it fell, each good scattered outward from its tile in canonical
 * ascending-goodType order. Call it after the destroy.
 *
 * Only tiles a fetcher could actually work are used: nothing standing, and the spill tile's own walk
 * component, so no heap is stranded under a wall or across a river. Whatever finds no tile inside
 * {@link spillOverRings}'s radius, or no walkable node near an unwalkable origin, is lost, the one place
 * this rule does not conserve goods.
 */
export function scatterSpilledStock(world: World, ctx: SystemContext, spill: SpilledStock | null): void {
  const terrain = ctx.terrain;
  if (spill === null || terrain === undefined) return;
  const n = nodeOfPosition(spill.x, spill.y);
  const at = terrain.nodeAtClamped(n.hx, n.hy);
  // An unwalkable origin, such as a site forced onto water, spills from the nearest walkable node.
  const from = terrain.isWalkable(at)
    ? at
    : ringSearch(terrain, at, NEAREST_NODE_SEARCH_CAP, { accept: () => true });
  if (from === null) return;
  const component = terrain.componentOf(from);
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const usable = (node: NodeId): boolean => !blocked.has(node) && terrain.componentOf(node) === component;
  for (const line of spill.goods) {
    spillOverRings(world, terrain, from, line.goodType, line.amount, usable, spill.maxRadius);
  }
}
