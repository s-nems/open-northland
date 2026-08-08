import { MoveGoal, PathFollow, PathRequest, Position, Stranded } from '../../components/index.js';
import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { closer, forEachRingOffset, manhattan, nodeKey } from '../footprint/geometry.js';

/**
 * Ascending entity-id order: the same canonical order `World.canonicalEntities` uses, so a distance or
 * first-match tie-break lands on the identical winner. Fed a `world.query(C)` it matches an `alive`-based
 * scan only because a store never holds a destroyed entity.
 */
export function canonicalById(entities: Iterable<Entity>): Entity[] {
  return [...entities].sort((a, b) => a - b);
}

/** Shared and frozen so an unoccupied-node lookup allocates nothing. */
const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

export { nodeKey };

/**
 * How many rings past the first hit {@link NodeBuckets.nearestFew} keeps walking. Without it a band holding
 * fewer acceptors than the caller asked for costs every ring out to `maxDist`. Approximation: three rings is
 * the huddle around the nearest target, so a garrison fans onto enemies beside its closest one rather than
 * onto stragglers half a map behind them.
 */
const NEAREST_FEW_TAIL_RINGS = 3;

/**
 * Entities grouped by their {@link Position}'s half-cell node, each bucket preserving input order. Feed the
 * constructor a {@link canonicalById} list: {@link NodeBuckets.nearest} is only canonical because buckets
 * hold ascending ids, and the build appends rather than sorts. {@link NodeBuckets.insert} is the seam for a
 * caller placing an entity at a node of its own - a building's wall cells, or a bucket filled out of order.
 * An entity without a Position is dropped. Derived state, never hashed.
 */
export class NodeBuckets {
  private readonly byX = new Map<number, Map<number, Entity[]>>();

  constructor(world: World, entities: Iterable<Entity>) {
    for (const e of entities) {
      const p = world.tryGet(e, Position);
      if (p === undefined) continue;
      this.bucketFor(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y)).push(e);
    }
  }

  private bucketFor(x: number, y: number): Entity[] {
    let column = this.byX.get(x);
    if (column === undefined) {
      column = new Map<number, Entity[]>();
      this.byX.set(x, column);
    }
    let bucket = column.get(y);
    if (bucket === undefined) {
      bucket = [];
      column.set(y, bucket);
    }
    return bucket;
  }

  /** The entities on node (x,y), in ascending-id order. */
  at(x: number, y: number): readonly Entity[] {
    return this.byX.get(x)?.get(y) ?? NO_ENTITIES;
  }

  /** Insert `e` into node (x,y)'s bucket, keeping it ascending-id. */
  insert(e: Entity, x: number, y: number): void {
    insertSortedById(this.bucketFor(x, y), e, (id) => id);
  }

  /** Remove `e` from node (x,y)'s bucket, dropping an emptied bucket and column. A no-op when `e` is
   *  not there. */
  remove(e: Entity, x: number, y: number): void {
    const column = this.byX.get(x);
    const bucket = column?.get(y);
    if (column === undefined || bucket === undefined) return;
    if (!removeSortedById(bucket, e, (id) => id)) return;
    if (bucket.length === 0) {
      column.delete(y);
      if (column.size === 0) this.byX.delete(x);
    }
  }

  /** Every non-empty bucket with its node. */
  *buckets(): IterableIterator<{ x: number; y: number; entities: readonly Entity[] }> {
    for (const [x, column] of this.byX) {
      for (const [y, entities] of column) yield { x, y, entities };
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
   * `accept` may re-enter this method: all ring state is call-local, so do not hoist `best` or `visit`
   * onto the instance.
   */
  nearest(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
  ): { entity: Entity; distance: number } | null {
    let best: Entity | null = null;
    const visit = (dx: number, dy: number): void => {
      best = this.pickMinId(fromX + dx, fromY + dy, accept, best);
    };
    for (let d = minDist; d <= maxDist; d++) {
      best = null;
      forEachRingOffset(d, visit);
      if (best !== null) return { entity: best, distance: d };
    }
    return null;
  }

  /**
   * The `limit` nearest bucketed entities satisfying `accept`, in the same (distance, then id) order
   * {@link nearest} picks its winner from, so `[0]` is exactly what `nearest` returns. An entity bucketed
   * at several nodes is listed once, at its nearest. The walk stops at the first of `limit` acceptors,
   * `maxDist`, or {@link NEAREST_FEW_TAIL_RINGS} past the first ring that hit.
   */
  nearestFew(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
    limit: number,
  ): readonly { entity: Entity; distance: number }[] {
    const found: { entity: Entity; distance: number }[] = [];
    const taken = new Set<Entity>();
    let lastRing = maxDist;
    for (let d = minDist; d <= lastRing && found.length < limit; d++) {
      const ring: Entity[] = [];
      forEachRingOffset(d, (dx, dy) => {
        for (const e of this.at(fromX + dx, fromY + dy)) {
          if (!taken.has(e) && accept(e)) {
            taken.add(e);
            ring.push(e);
          }
        }
      });
      ring.sort((a, b) => a - b);
      for (const entity of ring) found.push({ entity, distance: d });
      if (found.length > 0) lastRing = Math.min(lastRing, d + NEAREST_FEW_TAIL_RINGS);
    }
    return found.length > limit ? found.slice(0, limit) : found;
  }

  /** The lower-id of `best` and the smallest accepted entity on node (x,y). */
  private pickMinId(
    x: number,
    y: number,
    accept: (e: Entity) => boolean,
    best: Entity | null,
  ): Entity | null {
    for (const e of this.at(x, y)) {
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

export { closer, forEachRingOffset, manhattan };

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

/** Whether `e` has a navigation goal, a pending path request, or a path it is walking. */
export function isTravelling(world: World, e: Entity): boolean {
  return world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
}

/** Drop `e`'s whole navigation state: goal, pending request, followed path, and stranded-retry pacing. */
export function clearNavState(world: World, e: Entity): void {
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
  world.remove(e, Stranded);
}

/** Re-aim `e`'s live route at `dest`. PathFollow survives so the routing splice carries the gait through
 *  the turn; clearing it would reset the gait to zero on every re-aim. An unchanged goal is left alone so
 *  a same-dest request keeps its routing-queue slot, and Stranded is untouched because chasing and fleeing
 *  units are exempt from the planner's parking. */
export function redirectRoute(world: World, e: Entity, dest: NodeId): void {
  if (world.tryGet(e, MoveGoal)?.cell === dest) return;
  world.remove(e, PathRequest);
  world.add(e, MoveGoal, { cell: dest });
}
