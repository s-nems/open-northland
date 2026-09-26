import {
  Building,
  Carrying,
  Owner,
  Position,
  Signpost,
  Stockpile,
  Upgrading,
  WALK_RANGE_NODES,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';

/**
 * What a seat holds, by good: the one rule the HUD's summary bar and the AI's supply reads share, so a
 * player and the bot read the same figure. Every unit the seat holds, wherever it sits: the piles of its
 * buildings and boat hulls, the inventory a building keeps aside while it upgrades, the unit in a
 * settler's hands, and every heap on the ground (a felled trunk, an ore pile, a gatherer's yard heap, an
 * evicted stack; none is owned) strictly under {@link WALK_RANGE_NODES} of one of the seat's signposts or
 * buildings. The ground term is an approximation of the collecting settler's own limit
 * (`signposts/network.ts`): its post-range term, with the seat's buildings standing in for a collector's
 * own radius, and without group catching or terrain connectivity. A neutral store in reach of two seats
 * counts for both; no decoded map authors one.
 */
export interface SeatStock {
  /** The seat's units of `goodType`, 0 when it holds none. */
  units(goodType: number): number;
  /** Whether the seat holds more than `units` of `goodType`. */
  exceeds(goodType: number, units: number): boolean;
}

/** The bucket a node falls in: one square of {@link WALK_RANGE_NODES} on the half-cell lattice. */
const bucketKey = (hx: number, hy: number): string =>
  `${Math.floor(hx / WALK_RANGE_NODES)}:${Math.floor(hy / WALK_RANGE_NODES)}`;

/**
 * Whether a heap on `node` lies strictly under {@link WALK_RANGE_NODES} of one of `anchors`. A hexagon of
 * range r spans at most r columns and r rows each way, so an anchor within reach of a heap sits in the
 * heap's own bucket or one of its eight neighbours; bucketing the anchors once keeps the cost on the
 * heaps beside a settlement rather than one distance test per anchor for every heap on the map.
 */
export function heapReach(anchors: readonly HalfCellNode[]): (node: HalfCellNode) => boolean {
  const buckets = new Map<string, HalfCellNode[]>();
  for (const anchor of anchors) {
    const key = bucketKey(anchor.hx, anchor.hy);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [anchor]);
    else bucket.push(anchor);
  }
  return (node) => {
    const bx = Math.floor(node.hx / WALK_RANGE_NODES);
    const by = Math.floor(node.hy / WALK_RANGE_NODES);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = buckets.get(`${bx + dx}:${by + dy}`);
        if (bucket === undefined) continue;
        for (const anchor of bucket) {
          if (hexDistanceBetween(anchor.hx, anchor.hy, node.hx, node.hy) < WALK_RANGE_NODES) return true;
        }
      }
    }
    return false;
  };
}

/** The stores the figure reads; a cache over them is fresh while none has changed. */
const STOCK_STORES = [Stockpile, Owner, Position, Carrying, Upgrading, Building, Signpost] as const;

interface StockCache {
  readonly generations: readonly number[];
  readonly byPlayer: Map<number, SeatStock>;
}

const stockCaches = new WeakMap<World, StockCache>();

function stockGenerations(world: World): number[] {
  const generations: number[] = [];
  for (const store of STOCK_STORES) {
    generations.push(world.componentGeneration(store), world.componentValueGeneration(store));
  }
  return generations;
}

/**
 * `player`'s {@link SeatStock} as the world stands. Derived read-state, never hashed, memoized per world
 * until any store it reads changes: the modules of one seat's decision, and the seats deciding on one tick,
 * share a single pass over the stockpiles, the anchors and the carried units.
 */
export function seatStockOf(world: World, player: number): SeatStock {
  const generations = stockGenerations(world);
  let cache = stockCaches.get(world);
  if (cache === undefined || cache.generations.some((g, i) => g !== generations[i])) {
    cache = { generations, byPlayer: new Map() };
    stockCaches.set(world, cache);
  }
  let stock = cache.byPlayer.get(player);
  if (stock === undefined) {
    stock = deriveSeatStock(world, player);
    cache.byPlayer.set(player, stock);
  }
  return stock;
}

function deriveSeatStock(world: World, player: number): SeatStock {
  const totals = new Map<number, number>();
  const add = (amounts: ReadonlyMap<number, number> | undefined): void => {
    if (amounts === undefined) return;
    for (const [goodType, amount] of amounts) totals.set(goodType, (totals.get(goodType) ?? 0) + amount);
  };
  const anchors: HalfCellNode[] = [];
  const heaps: Entity[] = [];
  for (const e of world.query(Stockpile)) {
    const owner = world.tryGet(e, Owner)?.player;
    if (owner === undefined) {
      if (world.has(e, Position)) heaps.push(e);
      continue;
    }
    if (owner === player) add(world.get(e, Stockpile).amounts);
  }
  // Owner alone: a unit in the hands of a rider seated in a vehicle counts, though he stands nowhere.
  for (const e of world.query(Owner)) {
    if (world.get(e, Owner).player !== player) continue;
    const p = world.has(e, Building) || world.has(e, Signpost) ? world.tryGet(e, Position) : undefined;
    if (p !== undefined) anchors.push(nodeOfPosition(p.x, p.y));
    add(world.tryGet(e, Upgrading)?.savedStock);
    const carried = world.tryGet(e, Carrying);
    if (carried !== undefined)
      totals.set(carried.goodType, (totals.get(carried.goodType) ?? 0) + carried.amount);
  }
  const inReach = heapReach(anchors);
  for (const heap of heaps) {
    const p = world.get(heap, Position);
    if (inReach(nodeOfPosition(p.x, p.y))) add(world.get(heap, Stockpile).amounts);
  }
  return {
    units: (goodType) => totals.get(goodType) ?? 0,
    exceeds: (goodType, units) => (totals.get(goodType) ?? 0) > units,
  };
}
