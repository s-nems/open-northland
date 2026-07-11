import { MoveGoal, PathFollow, PathRequest, Position, Resource } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../nav/terrain.js';
import { manhattan, nodeKey } from './footprint/geometry.js';

// The cross-system SPATIAL primitives — canonical scan order, the per-tick node bucket + ring
// search, and the node/distance helpers. A leaf module (only footprint/geometry.ts below it) so every
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

/** The empty bucket returned for an unoccupied node — shared + frozen so a miss allocates nothing. */
const NO_ENTITIES: readonly Entity[] = Object.freeze([]);

// nodeKey lives in footprint/geometry.ts (the leaf below this one, which needs it first);
// re-exported here so consumers keep a single spatial import site.
export { nodeKey };

/**
 * A per-tick **spatial bucket**: `entities` grouped by their integer node, each bucket preserving the
 * input order. **Feed it a {@link canonicalById} list** — the ring search's first-accepted-per-node
 * shortcut ({@link NodeBuckets.nearest}) is only canonical because buckets hold ascending ids; a raw
 * `world.query` iterable would silently change ring-search winners. Answers "what is on node
 * (x,y)?" in O(1) via {@link NodeBuckets.at}, replacing a full-world scan for on-node checks (am I
 * standing on a workplace?). The bucket grid is the half-cell NODE lattice (`nodeOfPosition`) — the
 * sim's one integer grid. By default an entity buckets by its {@link Position}'s node; an optional
 * `nodeOf` resolver overrides that per entity (the JobSystem buckets buildings by their door-aware
 * {@link interactionNode}) — an entity the resolver maps to `null` (and a Position-less one) is dropped.
 * Determinism: a first-match pick over a bucket lands on the same entity a canonical full scan would,
 * because the node is fixed and the bucket keeps ascending-id order. Rebuilt each tick (derived state,
 * never hashed) — the cheap seam toward a full ring-search grid without touching sim state.
 */
export class NodeBuckets {
  private readonly byNode = new Map<string, Entity[]>();

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
      const key = nodeKey(node.x, node.y);
      let bucket = this.byNode.get(key);
      if (bucket === undefined) {
        bucket = [];
        this.byNode.set(key, bucket);
      }
      bucket.push(e);
    }
  }

  /** The entities on node (x,y), in ascending-id order — empty (shared) when the node is unoccupied. */
  at(x: number, y: number): readonly Entity[] {
    return this.byNode.get(nodeKey(x, y)) ?? NO_ENTITIES;
  }

  /**
   * The **nearest bucketed entity** to node `(fromX, fromY)` that satisfies `accept`, searched as
   * expanding Manhattan node-RINGS from `minDist` outward to `maxDist` — the grid ring search the
   * scaling doctrine (packages/sim/AGENTS.md "Full ring-search nearest-X", historical plan tier 3) calls for,
   * so a per-seeker "who's the closest enemy?" query costs O(bounded rings) instead of a full-world
   * scan. Returns the entity + its integer Manhattan distance, or null when nothing in the band matches.
   *
   * The winner is the SAME one a canonical full scan would pick — **(min distance, then min entity
   * id)** — because the search **finishes the whole minimum-distance ring before choosing**: it never
   * stops at the first hit within a ring, it scans every node of that ring and keeps the smallest id
   * (buckets are ascending-id, and the min is taken across the ring), so the result is independent of
   * the node-iteration order (determinism). Rings are visited in strictly increasing distance, so the
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
      // Ring d = every node at Manhattan distance EXACTLY d. For each column offset dx in [-d, d] the
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
export function isValidNodeId(terrain: TerrainGraph, node: number): boolean {
  return Number.isInteger(node) && node >= 0 && node < terrain.nodeCount;
}

/**
 * The half-cell node an entity occupies — its {@link Position} snapped to the navigation lattice.
 * The plain positional resolver for units/creatures/fixtures (a settler, a herd animal, a resource
 * node), where the entity's own node IS the node to measure from. Building targets a settler must
 * reach *through a door* use the AI planner's interaction-aware resolver instead (walls are
 * walk-blocked); this is the common case, shared by combat targeting and the herding follow-drive.
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

/**
 * Region edge (half-cell nodes) of the {@link resourcesNearNode} spatial index — square regions of
 * 32×32 nodes (≈16×16 cells). Sized so a flag-radius query (radius 24 + work-cell slack) touches a
 * handful of regions while region lists stay big enough that the per-query merge cost is trivial.
 * A named tuning constant, not a data pin: only query COST depends on it, never a winner.
 */
const RESOURCE_REGION_NODES = 32;
/** Region key packing (`rx * STRIDE + ry`): supports maps up to 65k regions per axis — far beyond
 *  any real map — while staying a plain number key (no string mint per lookup). */
const REGION_KEY_STRIDE = 1 << 16;

interface RegionMember {
  readonly e: Entity;
  /** The member's anchor node — kept beside the id so the box filter needs no store read per query. */
  readonly hx: number;
  readonly hy: number;
}

interface ResourceRegionIndex {
  /** The {@link Resource} store generation this index was derived at (see the invalidation note). */
  generation: number;
  /** Ascending-id list of every Resource+Position entity — the memoized {@link canonicalResources}. */
  list: Entity[];
  /** Region key → its members, each list ascending-id (built from the canonical list). */
  byRegion: Map<number, RegionMember[]>;
}

const resourceRegionCache = new WeakMap<World, ResourceRegionIndex>();

function regionKeyOf(hx: number, hy: number): number {
  return Math.floor(hx / RESOURCE_REGION_NODES) * REGION_KEY_STRIDE + Math.floor(hy / RESOURCE_REGION_NODES);
}

function buildResourceRegionIndex(world: World): ResourceRegionIndex {
  const list = canonicalById(world.query(Resource, Position));
  const byRegion = new Map<number, RegionMember[]>();
  for (const e of list) {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    const key = regionKeyOf(n.hx, n.hy);
    let bucket = byRegion.get(key);
    if (bucket === undefined) {
      bucket = [];
      byRegion.set(key, bucket);
    }
    bucket.push({ e, hx: n.hx, hy: n.hy }); // canonical input order → each region list stays ascending-id
  }
  return { generation: world.componentGeneration(Resource), list, byRegion };
}

function resourceRegionIndex(world: World): ResourceRegionIndex {
  const generation = world.componentGeneration(Resource);
  const cached = resourceRegionCache.get(world);
  if (cached !== undefined && cached.generation === generation) return cached;
  const fresh = buildResourceRegionIndex(world);
  resourceRegionCache.set(world, fresh);
  world.registerCacheVerifier('resourceRegionIndex', () => verifyResourceRegionIndex(world));
  return fresh;
}

function verifyResourceRegionIndex(world: World): string[] {
  const cached = resourceRegionCache.get(world);
  if (cached === undefined || cached.generation !== world.componentGeneration(Resource)) return [];
  const fresh = buildResourceRegionIndex(world);
  if (fresh.list.length !== cached.list.length || fresh.list.some((e, i) => cached.list[i] !== e)) {
    return [
      `resourceRegionIndex holds ${cached.list.length} resources but re-derived ${fresh.list.length} — a Resource/Position changed without a Resource-store generation bump`,
    ];
  }
  for (const [key, bucket] of fresh.byRegion) {
    const held = cached.byRegion.get(key);
    if (
      held === undefined ||
      held.length !== bucket.length ||
      bucket.some((m, i) => {
        const h = held[i];
        return h === undefined || h.e !== m.e || h.hx !== m.hx || h.hy !== m.hy;
      })
    ) {
      return [`resourceRegionIndex region ${key} diverges from a fresh rebuild — a resource moved in place`];
    }
  }
  return [];
}

/**
 * The memoized ascending-id list of every `Resource`+`Position` entity — what `collectTargets` used to
 * rebuild (query + sort, O(n log n)) EVERY tick: with a decoded map's ~17k standing nodes that per-tick
 * sort alone was a milliseconds-scale cost. Cached per world against the **Resource store generation**:
 * nodes are created/destroyed through `add`/`destroy` (which bump it), and a standing node never moves
 * or loses its Position without dying — the invariant the {@link resourceRegionIndex} verifier re-checks
 * under invariant-checked runs. Shared + read-only; callers must not mutate it.
 */
export function canonicalResources(world: World): readonly Entity[] {
  return resourceRegionIndex(world).list;
}

/**
 * Every resource whose ANCHOR node lies within the axis-aligned box `reach` nodes around `(hx, hy)`,
 * ascending-id — the flag-bound gatherer's candidate superset. The box is a SUPERSET of the true
 * "work cell within `radius` of the flag" disc as long as `reach ≥ radius + max work-cell offset`
 * (the caller adds that slack): any node whose work cell can pass the radius test has its anchor
 * within `radius + slack`, so scanning only these candidates provably picks the same winner as the
 * full canonical scan — the filter/rank loop itself is unchanged. Cost: O(regions touched + matches)
 * instead of O(all resources) per scan, the golden-rule-6 fix for per-gatherer whole-map scans.
 */
export function resourcesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  const index = resourceRegionIndex(world);
  const minRx = Math.floor(Math.max(0, hx - reach) / RESOURCE_REGION_NODES);
  const maxRx = Math.floor((hx + reach) / RESOURCE_REGION_NODES);
  const minRy = Math.floor(Math.max(0, hy - reach) / RESOURCE_REGION_NODES);
  const maxRy = Math.floor((hy + reach) / RESOURCE_REGION_NODES);
  const out: Entity[] = [];
  for (let rx = minRx; rx <= maxRx; rx++) {
    for (let ry = minRy; ry <= maxRy; ry++) {
      const bucket = index.byRegion.get(rx * REGION_KEY_STRIDE + ry);
      if (bucket === undefined) continue;
      for (const m of bucket) {
        if (Math.abs(m.hx - hx) <= reach && Math.abs(m.hy - hy) <= reach) out.push(m.e);
      }
    }
  }
  // Region lists are each ascending, but cross-region concatenation is not — restore the canonical
  // ascending-id order the nearest-scan's first-wins tie-break depends on.
  out.sort((a, b) => a - b);
  return out;
}
