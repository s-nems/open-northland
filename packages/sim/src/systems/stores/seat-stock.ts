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

export function seatStockFrom(totals: ReadonlyMap<number, number>): SeatStock {
  return {
    units: (goodType) => totals.get(goodType) ?? 0,
    exceeds: (goodType, units) => (totals.get(goodType) ?? 0) > units,
  };
}

/** Rows of reach buckets are this many keys apart. Two buckets share a key only on a map thousands of
 *  buckets wide, and a shared key costs extra exact distance tests, never a wrong answer. */
const BUCKET_ROW_STRIDE = 1 << 16;

/** The reach bucket a node falls in: one square of {@link WALK_RANGE_NODES} on the half-cell lattice. */
export function reachBucketOf(hx: number, hy: number): number {
  return Math.floor(hy / WALK_RANGE_NODES) * BUCKET_ROW_STRIDE + Math.floor(hx / WALK_RANGE_NODES);
}

/** A bucket key plus one of these is the bucket itself or one of its eight neighbours. */
export const NEIGHBOUR_BUCKET_OFFSETS: readonly number[] = [-1, 0, 1].flatMap((dy) =>
  [-1, 0, 1].map((dx) => dy * BUCKET_ROW_STRIDE + dx),
);

/** Whether a heap on `heap` lies in reach of an anchor on `anchor`. */
export function anchorReaches(anchor: HalfCellNode, heap: HalfCellNode): boolean {
  return hexDistanceBetween(anchor.hx, anchor.hy, heap.hx, heap.hy) < WALK_RANGE_NODES;
}

/**
 * Whether a heap on `node` lies strictly under {@link WALK_RANGE_NODES} of one of `anchors`. A hexagon of
 * range r spans at most r columns and r rows each way, so an anchor within reach of a heap sits in the
 * heap's own bucket or one of its eight neighbours; bucketing the anchors once keeps the cost on the
 * heaps beside a settlement rather than one distance test per anchor for every heap on the map.
 */
export function heapReach(anchors: readonly HalfCellNode[]): (node: HalfCellNode) => boolean {
  const buckets = new Map<number, HalfCellNode[]>();
  for (const anchor of anchors) {
    const key = reachBucketOf(anchor.hx, anchor.hy);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [anchor]);
    else bucket.push(anchor);
  }
  return (node) => {
    const key = reachBucketOf(node.hx, node.hy);
    for (const offset of NEIGHBOUR_BUCKET_OFFSETS) {
      const bucket = buckets.get(key + offset);
      if (bucket === undefined) continue;
      for (const anchor of bucket) if (anchorReaches(anchor, node)) return true;
    }
    return false;
  };
}

/** `player`'s units by good, folded from scratch over the map: the reference the incremental ledger is
 *  verified against. */
export function deriveSeatStockTotals(world: World, player: number): Map<number, number> {
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
  return totals;
}
