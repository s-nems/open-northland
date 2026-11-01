import { Position } from '../../components/index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from './metric.js';
import { moverNode } from './mover-node.js';
import { heldMoverNode } from './node-moves.js';

/**
 * Ascending entity-id order: the same canonical order `World.canonicalEntities` uses, so a distance or
 * first-match tie-break lands on the identical winner. For a plain component query use the shared
 * `World.canonicalQuery` instead of sorting here.
 */
export function canonicalById(entities: Iterable<Entity>): Entity[] {
  return [...entities].sort((a, b) => a - b);
}

const entityId = (e: Entity): number => e;

/** Shared and frozen so an unoccupied-node lookup allocates nothing. */
const NO_ENTITIES: readonly Entity[] = [];

/** Packs a node into one map key. A probe at `(x, -d)` aliases `(x - 1, 2^16 - d)`, which still reads
 *  empty because every map is far fewer than `2^16` half-rows tall, minus any ring radius. */
const NODE_KEY_STRIDE = 1 << 16;

function packedNodeKey(x: number, y: number): number {
  return x * NODE_KEY_STRIDE + y;
}

/** Occupancy filter sizes: powers of two, so a node hashes to a slot by a mask. The filter starts at the
 *  minimum once a bucket opens and doubles while it holds over 1/{@link OCCUPANCY_LOAD} of its slots,
 *  up to the maximum, so a small or short-lived index stays small. Two nodes whose `y` differs by the
 *  maximum share a slot at every size. */
const OCCUPANCY_MIN_SLOTS = 1 << 6;
export const OCCUPANCY_MAX_SLOTS = 1 << 14;
const OCCUPANCY_LOAD = 4;
/** Odd multiplier spreading neighbouring columns across the filter. */
const OCCUPANCY_X_MULTIPLIER = 0x9e3779b1;
const NO_FILTER = new Uint16Array(0);

function occupancySlot(x: number, y: number, mask: number): number {
  return (Math.imul(x, OCCUPANCY_X_MULTIPLIER) + y) & mask;
}

/** Stale buckets kept for reuse beyond this many times the live ones are dropped on the next refill. */
const STALE_BUCKET_RATIO = 4;

interface NodeBucket {
  x: number;
  y: number;
  /** The fill that last wrote the bucket; any other fill's bucket is empty, its array spare capacity. */
  fill: number;
  /** Entities written by the current fill; `entities` is trimmed to it once the fill ends. An emptied
   *  bucket keeps one stale entry at 0, so its array's backing store outlives the empty spell. */
  count: number;
  readonly entities: Entity[];
}

/**
 * Entities grouped by their half-cell node, a mover's by {@link moverNode}, each bucket preserving input
 * order. Feed the constructor or {@link NodeBuckets.refill} an ascending-id list:
 * {@link NodeBuckets.nearest} is only canonical because buckets hold ascending ids, and a fill appends
 * rather than sorts.
 * {@link NodeBuckets.insert} is the seam for a caller placing an entity at a node of its own - a
 * building's wall cells, or a bucket filled out of order. An entity without a Position is dropped.
 * Derived state, never hashed.
 */
export class NodeBuckets {
  private readonly byNode = new Map<number, NodeBucket>();
  private fill = 0;
  /** The buckets the current fill wrote; only the first `liveCount` are current. */
  private readonly live: NodeBucket[] = [];
  private liveCount = 0;
  /** Buckets {@link remove} emptied, re-keyed by the next node {@link insert} opens. */
  private readonly spare: NodeBucket[] = [];
  /** Non-empty current buckets per hashed node, so a ring search reads a zero for most empty nodes instead
   *  of missing in the map. A non-zero slot may still be another node's. */
  private occupied = NO_FILTER;
  /** Non-empty current buckets, the count the filter is sized against. */
  private occupiedBuckets = 0;

  constructor(world: World, entities: readonly Entity[]) {
    this.refill(world, entities);
  }

  /**
   * Empty every bucket and fill them from `entities`, reusing the buckets and their arrays, so an index
   * rebuilt every tick allocates only for nodes it has not held recently. Entries are overwritten in place
   * and trimmed afterwards: V8 frees an array's backing store at length 0, and the next push reallocates.
   */
  refill(world: World, entities: readonly Entity[]): void {
    this.fill++;
    if (this.occupiedBuckets > 0) this.occupied.fill(0);
    this.occupiedBuckets = 0;
    if (this.byNode.size > STALE_BUCKET_RATIO * this.liveCount) this.dropStale();
    this.liveCount = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e === undefined) continue;
      const p = world.tryGet(e, Position);
      if (p === undefined) continue;
      const node = moverNode(world, e, p);
      const bucket = this.filledBucket(node.hx, node.hy);
      if (bucket.count < bucket.entities.length) bucket.entities[bucket.count] = e;
      else bucket.entities.push(e);
      bucket.count++;
    }
    for (let i = 0; i < this.liveCount; i++) {
      const bucket = this.live[i];
      if (bucket !== undefined && bucket.entities.length !== bucket.count)
        bucket.entities.length = bucket.count;
    }
  }

  /** Forget the buckets the previous fill left empty, so the map follows where entities are rather than
   *  everywhere they have been. */
  private dropStale(): void {
    for (const bucket of this.byNode.values()) {
      if (bucket.fill !== this.fill - 1) this.byNode.delete(packedNodeKey(bucket.x, bucket.y));
    }
  }

  /** Node (x,y)'s bucket for the running fill, recorded live the first time the fill reaches it. */
  private filledBucket(x: number, y: number): NodeBucket {
    const bucket = this.bucketFor(x, y);
    if (bucket.fill !== this.fill) {
      bucket.fill = this.fill;
      bucket.count = 0;
      this.live[this.liveCount++] = bucket;
      this.occupy(x, y, 1);
    }
    return bucket;
  }

  private bucketFor(x: number, y: number): NodeBucket {
    const key = packedNodeKey(x, y);
    let bucket = this.byNode.get(key);
    if (bucket === undefined) {
      bucket = this.spare.pop();
      if (bucket === undefined) {
        bucket = { x, y, fill: -1, count: 0, entities: [] };
      } else {
        bucket.x = x;
        bucket.y = y;
        bucket.fill = -1;
        bucket.count = 0;
      }
      this.byNode.set(key, bucket);
    }
    return bucket;
  }

  /** Count node (x,y)'s bucket opening (1) or emptying (-1); an opening bucket is not yet counted live. */
  private occupy(x: number, y: number, delta: 1 | -1): void {
    if (delta > 0 && this.occupiedBuckets * OCCUPANCY_LOAD >= this.occupied.length) this.growFilter();
    const slot = occupancySlot(x, y, this.occupied.length - 1);
    this.occupied[slot] = (this.occupied[slot] as number) + delta;
    this.occupiedBuckets += delta;
  }

  private growFilter(): void {
    const size = Math.min(OCCUPANCY_MAX_SLOTS, Math.max(OCCUPANCY_MIN_SLOTS, 2 * this.occupied.length));
    if (size === this.occupied.length) return;
    const occupied = new Uint16Array(size);
    const mask = size - 1;
    for (const bucket of this.byNode.values()) {
      if (bucket.fill !== this.fill || bucket.count === 0) continue;
      const slot = occupancySlot(bucket.x, bucket.y, mask);
      occupied[slot] = (occupied[slot] as number) + 1;
    }
    this.occupied = occupied;
  }

  /** Node (x,y)'s bucket when the current fill wrote it. */
  private current(x: number, y: number): NodeBucket | undefined {
    if (this.occupiedBuckets === 0) return undefined;
    if (this.occupied[occupancySlot(x, y, this.occupied.length - 1)] === 0) return undefined;
    const bucket = this.byNode.get(packedNodeKey(x, y));
    return bucket?.fill === this.fill ? bucket : undefined;
  }

  /** The entities on node (x,y), in ascending-id order. */
  at(x: number, y: number): readonly Entity[] {
    const bucket = this.current(x, y);
    return bucket === undefined || bucket.count === 0 ? NO_ENTITIES : bucket.entities;
  }

  /** Insert `e` into node (x,y)'s bucket, keeping it ascending-id. */
  insert(e: Entity, x: number, y: number): void {
    const bucket = this.bucketFor(x, y);
    if (bucket.fill !== this.fill) {
      bucket.fill = this.fill;
      bucket.count = 0;
    }
    const { entities } = bucket;
    if (bucket.count === 0) {
      this.occupy(x, y, 1);
      // Overwrite the stale slot rather than empty the array, which would free its backing store.
      if (entities.length === 0) entities.push(e);
      else {
        entities.length = 1;
        entities[0] = e;
      }
      bucket.count = 1;
      return;
    }
    insertSortedById(entities, e, entityId);
    bucket.count = entities.length;
  }

  /** Remove `e` from node (x,y)'s bucket, dropping an emptied bucket. A no-op when `e` is not there. */
  remove(e: Entity, x: number, y: number): void {
    const bucket = this.current(x, y);
    if (bucket === undefined || bucket.count === 0) return;
    if (bucket.count === 1) {
      if (bucket.entities[0] !== e) return;
      bucket.count = 0;
      this.occupy(x, y, -1);
      this.byNode.delete(packedNodeKey(x, y));
      this.spare.push(bucket);
      return;
    }
    if (!removeSortedById(bucket.entities, e, entityId)) return;
    bucket.count = bucket.entities.length;
  }

  /** Every non-empty bucket with its node. */
  *buckets(): IterableIterator<{ x: number; y: number; entities: readonly Entity[] }> {
    for (const bucket of this.byNode.values()) {
      if (bucket.fill === this.fill && bucket.count > 0)
        yield { x: bucket.x, y: bucket.y, entities: bucket.entities };
    }
  }

  /**
   * The nearest bucketed entity to node `(fromX, fromY)` satisfying `accept`, searched as expanding
   * Manhattan node-rings over `minDist..maxDist`. The metric is integer half-cell-node Manhattan, the same
   * one the bucket key is derived from; `minDist` skips a near floor such as the seeker itself at 0.
   *
   * The winner matches a canonical full scan (min distance, then min entity id) because each ring is
   * finished before choosing and buckets are ascending-id, so node-iteration order cannot decide it.
   *
   * `accept` may re-enter this method: all ring state is call-local, so do not hoist `best` onto the
   * instance. It must not refill these buckets, which the search is iterating.
   */
  nearest(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
  ): { entity: Entity; distance: number } | null {
    for (let d = minDist; d <= maxDist; d++) {
      let best: Entity | null = null;
      const offsets = ringOffsetCount(d);
      for (let i = 0; i < offsets; i++) {
        best = this.pickMinId(fromX + ringOffsetDx(d, i), fromY + ringOffsetDy(d, i), accept, best);
      }
      if (best !== null) return { entity: best, distance: d };
    }
    return null;
  }

  /** The lower-id of `best` and the smallest accepted entity on node (x,y). */
  private pickMinId(
    x: number,
    y: number,
    accept: (e: Entity) => boolean,
    best: Entity | null,
  ): Entity | null {
    const bucket = this.at(x, y);
    for (let i = 0; i < bucket.length; i++) {
      const e = bucket[i];
      if (e === undefined) continue; // i < length, so only for the type
      if (!accept(e)) continue;
      // Ascending-id bucket: the first accepted entity is already this node's smallest.
      return best === null || e < best ? e : best;
    }
    return best;
  }
}

/**
 * Whether a raw node id is a valid index into the terrain graph (integer, `0..nodeCount-1`). An off-grid
 * goal is boundary input: callers treat it as "no route" rather than letting it throw inside the search.
 */
export function isValidNodeId(terrain: TerrainGraph, node: number): node is NodeId {
  return Number.isInteger(node) && node >= 0 && node < terrain.nodeCount;
}

/**
 * The half-cell node an entity occupies, clamped into the grid: its {@link Position}'s node, the
 * {@link moverNode} rule for a mover, read off the node-move pass while it is current. A building a
 * settler must reach through a door needs the AI planner's interaction-aware resolver instead, because
 * walls are walk-blocked.
 */
export function entityNode(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const node = heldMoverNode(world, e);
  return terrain.nodeAtClamped(node.hx, node.hy);
}

/** {@link entityNode} derived from the live components, for a verifier that must not trust a held node. */
export function derivedEntityNode(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const node = moverNode(world, e, world.get(e, Position));
  return terrain.nodeAtClamped(node.hx, node.hy);
}

/**
 * The 8 compass step offsets (E, W, S, N, then the diagonals). Callers index this array to make a
 * deterministic pick, so the order is part of the goldens.
 */
export const COMPASS_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];
