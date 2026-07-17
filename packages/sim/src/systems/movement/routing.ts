import { MoveGoal, Owner, PathFollow, PathRequest, Position } from '../../components/index.js';
import { type Fixed, fx, ZERO } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import { LayeredBlocks } from '../../nav/block-overlay.js';
import { positionOfNode, positionXOfWorld } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import { findPath, type SearchStats } from '../../nav/pathfinding/index.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { buildingBlockedCells, resourceBlockedCells } from '../footprint/index.js';
import { canonicalById, isValidNodeId } from '../spatial.js';
import { hasBodyCollision, type UnitWalkBlocks, unitWalkBlocks } from './collision/index.js';
import { turnOntoNextLeg } from './stepping.js';

// pathfindingSystem lives in routing.ts (not pathfinding.ts) to avoid an eyeball collision with the
// A* core in ../pathfinding.ts, which this system consumes. The cross-system `isValidNodeId` guard comes
// from the shared leaf.

/**
 * The pathfinder's per-tick work budget, in A*-settled nodes ({@link SearchStats.explored}) — what unit
 * search time is actually proportional to. Budgeting the cost (not a request count) lets crowd orders start
 * together: a battle-scale chase settles ~30–150 nodes, so a couple of hundred fighters route in one tick,
 * while a single cross-map route settling thousands still spreads over ticks. The budget is a soft ceiling
 * checked before each request (the one that overshoots still completes, so every tick makes progress);
 * serving stays lowest-entity-id-first and explored counts are deterministic, so the spread is
 * lockstep-safe. The magnitude is a tick-time guard (~a few ms of search on a modern core), not data-pinned:
 * tune against profiles as maps and armies grow.
 */
const PATHFINDING_NODE_BUDGET_PER_TICK = 16384;

/**
 * PathfindingSystem — drains pending {@link PathRequest}s and turns each into a followable path.
 *
 * Requests are served lowest entity id first until the tick's search-work budget
 * ({@link PATHFINDING_NODE_BUDGET_PER_TICK}, in A*-settled nodes) is spent — a cost cut, not a request
 * count, so a whole formation's cheap local routes land in one tick while expensive long routes still
 * spread (see the constant). For each served request it runs A* on `ctx.terrain` from `start` to `goal`. On
 * success it writes the node sequence into the entity's {@link PathFollow} (half-cell node positions in
 * fixed-point tile units, plus a seam waypoint inside each odd-row diagonal leg — {@link pathToWaypoints})
 * and removes the request; on failure it flags the request `failed` — keeping any live path, so a failed
 * mid-walk reroute parks the walker on a node centre instead of freezing it mid-leg — and leaves the request
 * for the planner to inspect rather than silently retrying. No-ops when no terrain graph is present.
 */
export const pathfindingSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: nothing to route over
  drainPathRequests(world, ctx, terrain, PATHFINDING_NODE_BUDGET_PER_TICK);
};

/**
 * The system's whole request-serving pass with an explicit `nodeBudget` — split out so tests can
 * exercise the budget cut with a tiny budget (the production constant is far above anything a
 * fixture map can settle). The budget is checked BEFORE each request and the overshooting request
 * still completes, so a tick always serves at least one pending request (progress is total).
 */
export function drainPathRequests(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  nodeBudget: number,
): void {
  // Serve in ascending entity-id order so the per-tick budget cut is canonical (never insertion order).
  // Scanning only the entities that have a request (canonicalById over the query — store ⊆ alive) keeps a
  // request-less tick at O(requests), not O(world).
  const spent: SearchStats = { explored: 0 };
  // The walk-block overlays, built lazily once per routing tick — only a tick that actually routes pays for
  // them. `dynamic` is the standing building bodies + resource footprints, kept as its two source SETS (the
  // small rebuilt building set and the incrementally-cached resource overlay) and only ever composed as a
  // layered membership view — never union-copied, which on a resource-dense map would dwarf the searches it
  // guards. `units` is the standing-collider stamp (see `unitWalkBlocks` — routing sees standing bodies,
  // never moving ones), and it applies only to a requester that itself collides (`hasBodyCollision`): a
  // ghost walks straight through bodies, so detouring it would break the economy's exact node-coincidence
  // walks. For a collider the two compose per requester player — another player's town posts block me, its
  // own never block it — memoized per player id seen this tick (-1 = an unowned collider).
  let dynamic: readonly [ReadonlySet<NodeId>, ReadonlySet<NodeId>] | undefined;
  let dynamicView: BlockOverlay | undefined;
  let units: UnitWalkBlocks | undefined;
  const combinedByPlayer = new Map<number, BlockOverlay>();
  // Goal stand-ins already handed out this tick, so two walkers aimed at one crowded node fan out to
  // different free nodes (the surround rule) instead of both claiming the same one.
  const claimedStandIns = new Set<NodeId>();
  const dynamicSets = (): readonly [ReadonlySet<NodeId>, ReadonlySet<NodeId>] => {
    dynamic ??= [buildingBlockedCells(world, ctx, terrain), resourceBlockedCells(world, terrain)];
    return dynamic;
  };
  const dynamicOnly = (): BlockOverlay => {
    dynamicView ??= new LayeredBlocks(dynamicSets());
    return dynamicView;
  };
  const blockedFor = (player: number): BlockOverlay => {
    let view = combinedByPlayer.get(player);
    if (view === undefined) {
      units ??= unitWalkBlocks(world, terrain, ctx.tick);
      const layers: Array<ReadonlySet<NodeId>> = [...dynamicSets(), units.field];
      for (const [p, town] of units.townByPlayer) {
        if (p === player) continue; // a player's own town garrison never blocks its own routing
        layers.push(town);
      }
      view = new LayeredBlocks(layers);
      combinedByPlayer.set(player, view);
    }
    return view;
  };

  for (const e of canonicalById(world.query(PathRequest))) {
    if (spent.explored >= nodeBudget) break;
    const req = world.get(e, PathRequest);
    if (req.failed) continue; // already-failed requests aren't retried

    const collides = hasBodyCollision(world, e);
    const blocked = collides ? blockedFor(world.tryGet(e, Owner)?.player ?? -1) : dynamicOnly();
    let path = resolvePath(terrain, req.start, req.goal, blocked, spent);
    if (path === null && collides && isValidNodeId(terrain, req.goal)) {
      // A goal occupied by a standing unit (in the unit stamp but not a wall/resource) is recoverable —
      // someone is simply standing there. Re-aim at the nearest free node instead of failing: this fans a
      // charge out around a crowded target (each arrival stands and the next walker is dealt the next free
      // node). Collider-only, like the overlay: a ghost's goal must stay exact.
      const goal = req.goal;
      if (blocked.has(goal) && !dynamicOnly().has(goal)) {
        const standIn = nearestUnblockedNode(terrain, goal, blocked, claimedStandIns);
        if (standIn !== null) {
          path = resolvePath(terrain, req.start, standIn, blocked, spent);
          if (path !== null) {
            claimedStandIns.add(standIn);
            // Keep the intent in step with the delivered route, or the planner would re-route back
            // at the occupied original every tick.
            const goalIntent = world.tryGet(e, MoveGoal);
            if (goalIntent !== undefined) goalIntent.cell = standIn;
          }
        }
      }
    }
    if (path === null) {
      req.failed = true; // signal the planner; keep the request so it isn't silently re-issued
      // A failed mid-walk reroute keeps the live path: the walker plays out its old route and parks on a
      // cell centre rather than freezing mid-leg (possibly off any centre) with a goal nothing services. A
      // request with no live path changes nothing.
      continue;
    }

    // Success: hand the entity a fresh PathFollow of waypoints and clear the request. A reroute (an entity
    // already walking) carries its gait `speed` and heading over, then turns onto the new first leg through
    // the same corner rule as a waypoint turn (`turnOntoNextLeg` below): a straight-ahead re-order keeps full
    // momentum (the responsive half of the movement-inertia approximation), a redirect sheds speed ×
    // cos(turn), and a reversal stops the gait dead.
    const prior = world.tryGet(e, PathFollow);
    const waypoints = pathToWaypoints(terrain, path);
    // If the entity is mid-tile when this route is issued (a re-path between cell centres, e.g. a player move
    // order interrupting a walk), the first waypoint is the centre of the cell it is already in, so following
    // verbatim makes it back up to that centre before turning. Drop that leading waypoint (when a next one
    // exists) so it heads straight for the following cell. An entity on a centre — every AI-issued route,
    // since the planner sets a goal only at a cell centre — keeps the full path, so goldens are untouched.
    const head = waypoints[0];
    const p = world.tryGet(e, Position);
    if (
      waypoints.length >= 2 &&
      head !== undefined &&
      p !== undefined &&
      (p.x !== head.x || p.y !== head.y)
    ) {
      waypoints.shift();
    }
    const follow = {
      waypoints,
      index: 0,
      speed: prior?.speed ?? ZERO,
      hx: prior?.hx ?? ZERO,
      hy: prior?.hy ?? ZERO,
    };
    // Turn the carried momentum onto the spliced first leg (a no-op from rest — the (0,0) sentinel
    // of a fresh path just records the heading, exactly what movement's first tick did).
    if (p !== undefined) turnOntoNextLeg(follow, p);
    world.add(e, PathFollow, follow);
    world.remove(e, PathRequest);
  }
}

/**
 * Turn a node path into the {@link PathFollow} waypoint list — half-cell node positions in fixed-point tile
 * units (`positionOfNode`), with one extra seam waypoint spliced into every diagonal leg that leaves an odd
 * half-row. Such a leg spans rows `r±½ → r∓½` and crosses the integer row mid-leg — where the stagger's
 * triangle wave kinks — so interpolating the grid delta linearly would swing the mover a quarter-column
 * sideways at the crossing. The seam is the world-straight midpoint of the edge (`(hx₁+hx₂)/4` columns) at
 * the integer row it crosses; with it each sub-leg stays inside one row interval, where linear grid motion is
 * straight on screen. Every other edge needs no seam: E/W stays on one row, and a half-row vertical or
 * even-row diagonal stays inside a single row interval. Pure fixed-point.
 */
function pathToWaypoints(terrain: TerrainGraph, path: ReadonlyArray<NodeId>): Array<{ x: Fixed; y: Fixed }> {
  const waypoints: Array<{ x: Fixed; y: Fixed }> = [];
  let prev: { x: number; y: number } | undefined;
  for (const cell of path) {
    const c = terrain.coordsOf(cell);
    if (prev !== undefined && Math.abs(c.y - prev.y) === 2 && (prev.y & 1) === 1) {
      // hy₁ odd and hy₂ = hy₁±2 make (hy₁+hy₂)/4 the integer row the leg crosses; the edge midpoint's
      // world x is (hx₁+hx₂)/4 columns (a quarter — exact in fixed point), converted to Position x
      // by the one stagger-removal seam.
      const rowY = fx.fromInt((prev.y + c.y) / 4);
      const midWorldX = fx.div(fx.fromInt(prev.x + c.x), fx.fromInt(4));
      waypoints.push({ x: positionXOfWorld(midWorldX, rowY), y: rowY });
    }
    const p = positionOfNode(c.x, c.y);
    waypoints.push({ x: p.x, y: p.y });
    prev = c;
  }
  return waypoints;
}

/**
 * Run A* for a request, guarding the raw cell ids against the graph bounds first. An id outside
 * `0..nodeCount-1` is a bad request (e.g. a goal off a smaller map) — treat it as "no route"
 * (null) rather than letting it throw inside the heuristic, since a request is boundary input.
 */
function resolvePath(
  terrain: TerrainGraph,
  start: number,
  goal: number,
  blocked: BlockOverlay,
  stats: SearchStats,
): NodeId[] | null {
  if (!isValidNodeId(terrain, start) || !isValidNodeId(terrain, goal)) return null;
  return findPath(terrain, start, goal, blocked, stats);
}
