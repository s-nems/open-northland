import { Position } from '../../components/index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from './metric.js';

/**
 * Ascending entity-id order: the same canonical order `World.canonicalEntities` uses, so a distance or
 * first-match tie-break lands on the identical winner. For a plain component query use the shared
 * `World.canonicalQuery` instead of sorting here.
 */
export function canonicalById(entities: Iterable<Entity>): Entity[] {
  return [...entities].sort((a, b) => a - b);
}

/** Shared and frozen so an unoccupied-node lookup allocates nothing. */
const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

/** Packs a node into one map key. A probe at `(x, -d)` aliases `(x - 1, 2^16 - d)`, which still reads
 *  empty because every map is far fewer than `2^16` half-rows tall, minus any ring radius. */
const NODE_KEY_STRIDE = 1 << 16;

function packedNodeKey(x: number, y: number): number {
  return x * NODE_KEY_STRIDE + y;
}

/** Stale buckets kept for reuse beyond this many times the live ones are dropped on the next refill. */
const STALE_BUCKET_RATIO = 4;

interface NodeBucket {
  readonly x: number;
  readonly y: number;
  /** The fill that last wrote the bucket; any other fill's bucket is empty, its array spare capacity. */
  fill: number;
  /** Entities written by the current fill; `entities` is trimmed to it once the fill ends. */
  count: number;
  readonly entities: Entity[];
}

/**
 * Entities grouped by their {@link Position}'s half-cell node, each bucket preserving input order. Feed the
 * constructor or {@link NodeBuckets.refill} an ascending-id list: {@link NodeBuckets.nearest} is only
 * canonical because buckets hold ascending ids, and a fill appends rather than sorts.
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

  constructor(world: World, entities: Iterable<Entity>) {
    this.refill(world, entities);
  }

  /**
   * Empty every bucket and fill them from `entities`, reusing the buckets and their arrays, so an index
   * rebuilt every tick allocates only for nodes it has not held recently. Entries are overwritten in place
   * and trimmed afterwards: V8 frees an array's backing store at length 0, and the next push reallocates.
   */
  refill(world: World, entities: Iterable<Entity>): void {
    this.fill++;
    if (this.byNode.size > STALE_BUCKET_RATIO * this.liveCount) this.dropStale();
    this.liveCount = 0;
    for (const e of entities) {
      const p = world.tryGet(e, Position);
      if (p === undefined) continue;
      const bucket = this.filledBucket(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
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
    }
    return bucket;
  }

  private bucketFor(x: number, y: number): NodeBucket {
    const key = packedNodeKey(x, y);
    let bucket = this.byNode.get(key);
    if (bucket === undefined) {
      bucket = { x, y, fill: -1, count: 0, entities: [] };
      this.byNode.set(key, bucket);
    }
    return bucket;
  }

  /** Node (x,y)'s bucket when the current fill wrote it. */
  private current(x: number, y: number): NodeBucket | undefined {
    const bucket = this.byNode.get(packedNodeKey(x, y));
    return bucket?.fill === this.fill ? bucket : undefined;
  }

  /** The entities on node (x,y), in ascending-id order. */
  at(x: number, y: number): readonly Entity[] {
    return this.current(x, y)?.entities ?? NO_ENTITIES;
  }

  /** Insert `e` into node (x,y)'s bucket, keeping it ascending-id. */
  insert(e: Entity, x: number, y: number): void {
    const bucket = this.bucketFor(x, y);
    if (bucket.fill !== this.fill) {
      bucket.fill = this.fill;
      bucket.entities.length = 0;
    }
    insertSortedById(bucket.entities, e, (id) => id);
    bucket.count = bucket.entities.length;
  }

  /** Remove `e` from node (x,y)'s bucket, dropping an emptied bucket. A no-op when `e` is not there. */
  remove(e: Entity, x: number, y: number): void {
    const bucket = this.current(x, y);
    if (bucket === undefined || !removeSortedById(bucket.entities, e, (id) => id)) return;
    bucket.count = bucket.entities.length;
    if (bucket.count === 0) this.byNode.delete(packedNodeKey(x, y));
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
 * The half-cell node an entity occupies: its {@link Position} snapped to the navigation lattice. A building
 * a settler must reach through a door needs the AI planner's interaction-aware resolver instead, because
 * walls are walk-blocked.
 */
export function entityNode(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const p = world.get(e, Position);
  return terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
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
