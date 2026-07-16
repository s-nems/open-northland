import { MoveGoal, PathFollow, PathRequest, Position, Stranded } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../nav/terrain/index.js';
import { manhattan, nodeKey } from './footprint/geometry.js';

// The cross-system spatial primitives — canonical scan order, the per-tick node bucket + ring search, and
// the node/distance helpers. A leaf module (only footprint/geometry.ts below it) so every per-system file
// imports these without creating cycles; the store/economy read-model lives in ./stores.ts, the same split.

/**
 * Ascending entity-id (canonical) ordering of `entities` — the deterministic scan order a system needs when
 * it picks an entity (nearest target, first open job): the same order `World.canonicalEntities` uses, so a
 * distance / first-match tie-break lands on the identical winner. Build this once per tick from a
 * `world.query(...)` and scan the result across all units, instead of each unit re-scanning the whole world
 * — turning `O(units · entities · log n)` into `O(entities + units · matching)`.
 *
 * Fed a `world.query(C)` this yields the same ascending-id subsequence the old `canonicalEntities()`-then-
 * filter scan did, but only because the ECS holds `store ⊆ alive` (a store never keeps a destroyed entity):
 * a use-after-`destroy` bug would make query-based pickers diverge from `alive`-based ones.
 */
export function canonicalById(entities: Iterable<Entity>): Entity[] {
  return [...entities].sort((a, b) => a - b);
}

/** The empty bucket returned for an unoccupied node — shared + frozen so a miss allocates nothing. */
const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

// nodeKey lives in footprint/geometry.ts (the leaf below this one, which needs it first);
// re-exported here so consumers keep a single spatial import site.
export { nodeKey };

/**
 * A per-tick spatial bucket: `entities` grouped by their integer node, each bucket preserving the input
 * order. Feed it a {@link canonicalById} list — the ring search's first-accepted-per-node shortcut
 * ({@link NodeBuckets.nearest}) is only canonical because buckets hold ascending ids; a raw `world.query`
 * iterable would silently change ring-search winners. Answers "what is on node (x,y)?" in O(1) via
 * {@link NodeBuckets.at}, replacing a full-world scan for on-node checks. The bucket grid is the half-cell
 * node lattice (`nodeOfPosition`). By default an entity buckets by its {@link Position}'s node; an optional
 * `nodeOf` resolver overrides that per entity (the JobSystem buckets buildings by their door-aware
 * {@link interactionNode}) — an entity the resolver maps to `null` (and a Position-less one) is dropped. The
 * nested numeric maps keep negative/off-map probes collision-free without string keys; rebuilt each tick
 * (derived state, never hashed).
 */
export class NodeBuckets {
  private readonly byX = new Map<number, Map<number, Entity[]>>();

  constructor(
    world: World,
    entities: Iterable<Entity>,
    nodeOf?: (e: Entity) => { x: number; y: number } | null,
  ) {
    for (const e of entities) {
      let node: { x: number; y: number } | null;
      if (nodeOf === undefined) {
        const p = world.tryGet(e, Position);
        if (p === undefined) {
          node = null;
        } else {
          const n = nodeOfPosition(p.x, p.y);
          node = { x: n.hx, y: n.hy };
        }
      } else {
        node = nodeOf(e);
      }
      if (node === null) continue;
      let column = this.byX.get(node.x);
      if (column === undefined) {
        column = new Map<number, Entity[]>();
        this.byX.set(node.x, column);
      }
      let bucket = column.get(node.y);
      if (bucket === undefined) {
        bucket = [];
        column.set(node.y, bucket);
      }
      bucket.push(e);
    }
  }

  /** The entities on node (x,y), in ascending-id order — empty (shared) when the node is unoccupied. */
  at(x: number, y: number): readonly Entity[] {
    return this.byX.get(x)?.get(y) ?? NO_ENTITIES;
  }

  /**
   * The nearest bucketed entity to node `(fromX, fromY)` that satisfies `accept`, searched as expanding
   * Manhattan node-rings from `minDist` outward to `maxDist` — the grid ring search the scaling doctrine
   * (packages/sim/AGENTS.md "Full ring-search nearest-X") calls for, so a per-seeker "who's the closest
   * enemy?" query costs O(bounded rings) instead of a full-world scan. Returns the entity + its integer
   * Manhattan distance, or null when nothing in the band matches.
   *
   * The winner is the same one a canonical full scan would pick — min distance, then min entity id —
   * because the search finishes the whole minimum-distance ring before choosing: it scans every node of that
   * ring and keeps the smallest id (buckets are ascending-id), so the result is independent of node-iteration
   * order. Rings are visited in strictly increasing distance, so the first ring with any accepted entity
   * holds the nearest and the search returns without touching a farther ring; it stops entirely once `d`
   * passes `maxDist`.
   *
   * `minDist` skips entities nearer than a floor (a ranged weapon's near reach, or excluding the seeker
   * itself at distance 0). The metric is integer half-cell-node Manhattan — the exact metric
   * {@link manhattan} measures and the one an entity's bucket key (`nodeOfPosition`) is derived from.
   * `accept` is the caller's pure per-candidate relation, evaluated at most once per candidate in the band.
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
      // Ring d = every node at Manhattan distance exactly d. For each column offset dx in [-d, d] the two
      // rows dy = ±(d - |dx|) complete the diamond (a single row when the remainder is 0, at the ring's E/W
      // tips).
      for (let dx = -d; dx <= d; dx++) {
        const rem = d - Math.abs(dx);
        best = this.pickMinId(fromX + dx, fromY + rem, accept, best);
        if (rem !== 0) best = this.pickMinId(fromX + dx, fromY - rem, accept, best);
      }
      if (best !== null) return { entity: best, distance: d };
    }
    return null;
  }

  /** The lower-id of `best` and the smallest accepted entity on node (x,y) — the per-node step of the
   *  ring search's min-id pick (buckets are ascending-id, so the first accepted entity on a node is its
   *  smallest, but we still min against `best` across the ring's other nodes). */
  private pickMinId(
    x: number,
    y: number,
    accept: (e: Entity) => boolean,
    best: Entity | null,
  ): Entity | null {
    for (const e of this.at(x, y)) {
      if (!accept(e)) continue;
      // Ascending-id bucket: the first accepted entity is this node's smallest — take it against the
      // running ring minimum and stop scanning this node.
      return best === null || e < best ? e : best;
    }
    return best;
  }
}

/**
 * Whether a raw node id is a valid index into the terrain graph (`0..nodeCount-1`, integer). A
 * request/goal id outside the grid is boundary input — callers treat it as "no route" rather than
 * letting it throw inside the search.
 *
 * Cross-system: used by the AI navigation planner (drop an off-map goal) and the pathfinding system
 * (guard the A* endpoints).
 */
export function isValidNodeId(terrain: TerrainGraph, node: number): node is NodeId {
  return Number.isInteger(node) && node >= 0 && node < terrain.nodeCount;
}

/**
 * The half-cell node an entity occupies — its {@link Position} snapped to the navigation lattice. The plain
 * positional resolver for units/creatures/fixtures (a settler, a herd animal, a resource node), where the
 * entity's own node is the node to measure from. Building targets a settler must reach through a door use the
 * AI planner's interaction-aware resolver instead (walls are walk-blocked); this is the common case, shared
 * by combat targeting and the herding follow-drive.
 */
export function entityNode(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrain.nodeAtClamped(n.hx, n.hy);
}

// manhattan lives in footprint/geometry.ts (the leaf, which needs it for its nearest-node picks)
// and is re-exported here with nodeKey so consumers keep the single spatial import site.
export { manhattan };

/**
 * The 8 compass step offsets (E, W, S, N, then the four diagonals) in the fixed canonical order the sim's
 * direction-indexed picks share: the herd-spawn scatter ring walks it by member index and the combat flee
 * drive scores destinations along it. One shared tuple so the two can never drift — the order is part of the
 * goldens (an index into this array is a deterministic pick).
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

/** Whether `e` is mid-journey: it has a navigation goal, a pending path request, or a path it is
 *  walking. The shared "is it travelling?" predicate the combat gates and the AI planner's idle
 *  checks apply identically. */
export function isTravelling(world: World, e: Entity): boolean {
  return world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
}

/** Drop `e`'s whole navigation state (goal + pending request + followed path + stranded-retry pacing)
 *  — the counterpart of {@link isTravelling}, used when an authoritative drive (a chase ending, an
 *  order) cancels travel. */
export function clearNavState(world: World, e: Entity): void {
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
  world.remove(e, Stranded);
}

/** Re-aim `e`'s live route at `dest` — the throttled-re-aim twin of {@link clearNavState} (chase and
 *  flee): keep any PathFollow so the routing splice carries the gait through the turn (clearing it
 *  resets the gait to zero every re-aim — a visible lurch), drop only a stale in-flight request, and
 *  leave an unchanged goal alone so a same-dest request keeps its routing-queue slot. */
export function redirectRoute(world: World, e: Entity, dest: NodeId): void {
  if (world.tryGet(e, MoveGoal)?.cell === dest) return;
  world.remove(e, PathRequest);
  world.add(e, MoveGoal, { cell: dest });
}
