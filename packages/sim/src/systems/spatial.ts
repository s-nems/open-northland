import { MoveGoal, PathFollow, PathRequest, Position } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import type { CellId, TerrainGraph } from '../nav/terrain.js';
import { manhattan, tileKey } from './footprint/geometry.js';

// The cross-system SPATIAL primitives — canonical scan order, the per-tick tile bucket + ring
// search, and the cell/distance helpers. A leaf module (only footprint/geometry.ts below it) so every
// per-system file imports these without creating cycles; the store/economy read-model lives in
// ./stores.ts, the same split.

/**
 * Ascending entity-id (canonical) ordering of `entities` — the deterministic scan order a system needs
 * when it **picks** an entity (nearest target, first open job): the same order `World.canonicalEntities`
 * uses, so a distance / first-match tie-break lands on the identical winner (goldens unchanged). Build
 * this ONCE per tick from a `world.query(...)` (which is `O(min store)`) and scan the result across all
 * units, instead of each unit re-scanning + re-sorting the whole world — the fix that turns a per-unit
 * full-world scan from `O(units · entities · log n)` into `O(entities + units · matching)`.
 *
 * Determinism note: fed a `world.query(C)` this yields the same ascending-id subsequence the old
 * `canonicalEntities()`-then-filter scan did — but only because the ECS holds `store ⊆ alive` (a
 * component store never keeps a destroyed entity; `destroy()` clears all stores). That invariant is
 * already load-bearing (`query` drives every system loop); a use-after-`destroy` bug would make
 * query-based pickers diverge from `alive`-based ones.
 */
export function canonicalById(entities: Iterable<Entity>): Entity[] {
  return [...entities].sort((a, b) => a - b);
}

/** The empty bucket returned for an unoccupied tile — shared + frozen so a miss allocates nothing. */
const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

// tileKey lives in footprint/geometry.ts (the leaf below this one, which needs it first);
// re-exported here so consumers keep a single spatial import site.
export { tileKey };

/**
 * A per-tick **spatial bucket**: `entities` grouped by their integer tile, each bucket preserving the
 * input order. **Feed it a {@link canonicalById} list** — the ring search's first-accepted-per-tile
 * shortcut ({@link TileBuckets.nearest}) is only canonical because buckets hold ascending ids; a raw
 * `world.query` iterable would silently change ring-search winners. Answers "what is on tile
 * (x,y)?" in O(1) via {@link TileBuckets.at}, replacing a full-world scan for on-tile checks (am I
 * standing on a workplace?). A "tile" here is a half-cell NODE (`nodeOfPosition`) — the sim's one
 * integer grid. By default an entity buckets by its {@link Position}'s node; an optional
 * `tileOf` resolver overrides that per entity (the JobSystem buckets buildings by their door-aware
 * {@link interactionTile}) — an entity the resolver maps to `null` (and a Position-less one) is dropped.
 * Determinism: a first-match pick over a bucket lands on the same entity a canonical full scan would,
 * because the tile is fixed and the bucket keeps ascending-id order. Rebuilt each tick (derived state,
 * never hashed) — the cheap seam toward a full ring-search grid without touching sim state.
 */
export class TileBuckets {
  private readonly byTile = new Map<string, Entity[]>();

  constructor(
    world: World,
    entities: Iterable<Entity>,
    tileOf?: (e: Entity) => { x: number; y: number } | null,
  ) {
    for (const e of entities) {
      let tile: { x: number; y: number } | null;
      if (tileOf === undefined) {
        const p = world.tryGet(e, Position);
        if (p === undefined) {
          tile = null;
        } else {
          const n = nodeOfPosition(p.x, p.y);
          tile = { x: n.hx, y: n.hy };
        }
      } else {
        tile = tileOf(e);
      }
      if (tile === null) continue;
      const key = tileKey(tile.x, tile.y);
      let bucket = this.byTile.get(key);
      if (bucket === undefined) {
        bucket = [];
        this.byTile.set(key, bucket);
      }
      bucket.push(e);
    }
  }

  /** The entities on tile (x,y), in ascending-id order — empty (shared) when the tile is unoccupied. */
  at(x: number, y: number): readonly Entity[] {
    return this.byTile.get(tileKey(x, y)) ?? NO_ENTITIES;
  }

  /**
   * The **nearest bucketed entity** to tile `(fromX, fromY)` that satisfies `accept`, searched as
   * expanding Manhattan tile-RINGS from `minDist` outward to `maxDist` — the grid ring search the
   * scaling doctrine (packages/sim/AGENTS.md "Full ring-search nearest-X", historical plan tier 3) calls for,
   * so a per-seeker "who's the closest enemy?" query costs O(bounded rings) instead of a full-world
   * scan. Returns the entity + its integer Manhattan distance, or null when nothing in the band matches.
   *
   * The winner is the SAME one a canonical full scan would pick — **(min distance, then min entity
   * id)** — because the search **finishes the whole minimum-distance ring before choosing**: it never
   * stops at the first hit within a ring, it scans every tile of that ring and keeps the smallest id
   * (buckets are ascending-id, and the min is taken across the ring), so the result is independent of
   * the tile-iteration order (determinism). Rings are visited in strictly increasing distance, so the
   * first ring with any accepted entity holds the nearest; the search then returns without touching a
   * farther ring (the short-circuit that makes it cheap), and it stops entirely once `d` passes
   * `maxDist` (an empty query never scans past its radius).
   *
   * `minDist` skips entities nearer than a floor (a ranged weapon's near reach, or excluding the
   * seeker itself at distance 0). The metric is integer HALF-CELL-NODE Manhattan — the exact metric
   * {@link manhattan} measures over node coords and the one an entity's bucket key
   * (`nodeOfPosition`) is derived from — so a ring at distance `d` holds precisely the entities a
   * full scan would score at distance `d`. Determinism: no RNG/wall-clock; a pure ring walk with a
   * min-id tie-break. Reads no world state beyond the pre-bucketed entities — `accept` is the
   * caller's pure per-candidate relation (a hostility test), evaluated at most once per candidate
   * in the band.
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
      // Ring d = every tile at Manhattan distance EXACTLY d. For each column offset dx in [-d, d] the
      // two rows dy = ±(d - |dx|) complete the diamond (a single row when the remainder is 0, at the
      // ring's E/W tips). The whole ring is scanned before choosing so the min-id pick is canonical.
      for (let dx = -d; dx <= d; dx++) {
        const rem = d - Math.abs(dx);
        best = this.pickMinId(fromX + dx, fromY + rem, accept, best);
        if (rem !== 0) best = this.pickMinId(fromX + dx, fromY - rem, accept, best);
      }
      if (best !== null) return { entity: best, distance: d };
    }
    return null;
  }

  /** The lower-id of `best` and the smallest accepted entity on tile (x,y) — the per-tile step of the
   *  ring search's min-id pick (buckets are ascending-id, so the first accepted entity on a tile is its
   *  smallest, but we still min against `best` across the ring's other tiles). */
  private pickMinId(
    x: number,
    y: number,
    accept: (e: Entity) => boolean,
    best: Entity | null,
  ): Entity | null {
    for (const e of this.at(x, y)) {
      if (!accept(e)) continue;
      // Ascending-id bucket: the first accepted entity is this tile's smallest — take it against the
      // running ring minimum and stop scanning this tile.
      return best === null || e < best ? e : best;
    }
    return best;
  }
}

/**
 * Whether a raw cell id is a valid index into the terrain graph (`0..cellCount-1`, integer). A
 * request/goal id outside the grid is boundary input — callers treat it as "no route" rather than
 * letting it throw inside the search.
 *
 * Cross-system: used by the AI navigation planner (drop an off-map goal) and the pathfinding system
 * (guard the A* endpoints).
 */
export function isValidCellId(terrain: TerrainGraph, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < terrain.cellCount;
}

/**
 * The half-cell node an entity occupies — its {@link Position} snapped to the navigation lattice.
 * The plain positional resolver for units/creatures/fixtures (a settler, a herd animal, a resource
 * node), where the entity's own node IS the cell to measure from. Building targets a settler must
 * reach *through a door* use the AI planner's interaction-aware resolver instead (walls are
 * walk-blocked); this is the common case, shared by combat targeting and the herding follow-drive.
 */
export function entityCell(world: World, terrain: TerrainGraph, e: Entity): CellId {
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrain.cellAtClamped(n.hx, n.hy);
}

// manhattan lives in footprint/geometry.ts (the leaf, which needs it for its nearest-cell picks)
// and is re-exported here with tileKey so consumers keep the single spatial import site.
export { manhattan };

/**
 * The 8 compass step offsets (E, W, S, N, then the four diagonals) in the fixed canonical order the
 * sim's direction-indexed picks share: the herd-spawn scatter ring walks it by member index and the
 * combat flee drive scores destinations along it. One shared tuple so the two can never drift —
 * the ORDER is part of the goldens (an index into this array is a deterministic pick).
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

/** Drop `e`'s whole navigation state (goal + pending request + followed path) — the counterpart of
 *  {@link isTravelling}, used when an authoritative drive (a chase ending, an order) cancels travel. */
export function clearNavState(world: World, e: Entity): void {
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
}
