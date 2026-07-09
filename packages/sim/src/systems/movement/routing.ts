import { PathFollow, PathRequest, Position } from '../../components/index.js';
import { type Fixed, ZERO, fx } from '../../core/fixed.js';
import { positionOfNode, positionXOfWorld } from '../../nav/halfcell.js';
import { findPath } from '../../nav/pathfinding.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { System } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import { canonicalById, isValidNodeId } from '../spatial.js';
import { turnOntoNextLeg } from './movement.js';

// pathfindingSystem lives in routing.ts (not pathfinding.ts) to avoid an eyeball collision with the
// A* core in ../pathfinding.ts, which this system consumes. The cross-system `isValidNodeId` guard comes
// from the shared leaf. See docs/plans/.

/**
 * The maximum number of {@link PathRequest}s the pathfinder will resolve in a single tick. A*
 * is the heaviest per-call work in the schedule, so spreading many requests over several ticks
 * keeps the tick cost bounded — the budget is the determinism-safe spread (we always serve the
 * lowest entity ids first, never a wall-clock cutoff). Tune as crowds grow; one is plenty for
 * the single-settler slice.
 */
export const PATHFINDING_BUDGET_PER_TICK = 8;

/**
 * PathfindingSystem — drains pending {@link PathRequest}s and turns each into a followable path.
 *
 * For up to {@link PATHFINDING_BUDGET_PER_TICK} requests per tick (lowest entity ids first, so the
 * spread is history-independent), it runs A* on `ctx.terrain` from the request's `start` to `goal`
 * cell. On success it writes the node sequence into the entity's {@link PathFollow} (half-cell node
 * positions in fixed-point tile units, plus a seam waypoint inside each odd-row diagonal leg —
 * {@link pathToWaypoints})
 * and removes the request; on failure it flags the request `failed` — keeping any live path, so a
 * failed mid-walk reroute parks the walker on a node centre instead of freezing it mid-leg — and
 * leaves the request for the planner to inspect rather than silently retrying the same dead query
 * every tick. No-ops entirely when no terrain graph is present — a
 * mapless sim (the determinism golden) has nothing to route over.
 *
 * Determinism: A* is pure and canonically tie-broken; requests are served in ascending entity-id
 * order (a canonical sort, not Map insertion order); cell ids are validated against the graph so an
 * out-of-range request fails gracefully instead of throwing inside the search.
 */
export const pathfindingSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: nothing to route over

  // Serve in ascending entity-id order so the per-tick budget cut is canonical (never insertion
  // order). Scan only the entities that HAVE a request (canonicalById over the query yields the same
  // ascending-id subsequence a full canonicalEntities() filter did — store ⊆ alive), so a tick with
  // no requests costs O(requests), not O(world).
  let served = 0;
  // The walk-block overlay (standing building bodies + resource footprints), built lazily ONCE per
  // routing tick — only a tick that actually routes pays for it. Building cells are derived live;
  // resource cells come from the ResourceFootprint generation cache.
  let blocked: ReadonlySet<NodeId> | undefined;
  for (const e of canonicalById(world.query(PathRequest))) {
    if (served >= PATHFINDING_BUDGET_PER_TICK) break;
    const req = world.get(e, PathRequest);
    if (req.failed) continue; // already-failed requests aren't retried
    served++;

    blocked ??= dynamicBlockedCells(world, ctx, terrain);
    const path = resolvePath(terrain, req.start, req.goal, blocked);
    if (path === null) {
      req.failed = true; // signal the planner; keep the request so it isn't silently re-issued
      // A failed MID-WALK reroute keeps the live path: the walker plays out its old route and parks
      // on a cell centre. Dropping it froze the walker wherever it stood — possibly on a seam
      // waypoint, off any centre — with a goal nothing services (the planner skips entities with a
      // request, and failed requests are never retried). A request with no live path changes nothing.
      continue;
    }

    // Success: hand the entity a fresh PathFollow of waypoints and clear the request. A REROUTE (an
    // entity already walking a path) carries its gait `speed` AND heading over, then turns onto the
    // new first leg through the SAME corner rule as a waypoint turn (`turnOntoNextLeg` below):
    // straight-ahead re-orders keep full momentum (the responsive half of the movement-inertia
    // approximation), a redirect sheds speed × cos(turn), and a reversal stops the gait dead.
    // Without the projection a redirected walker kept full pace through any flip — the full-speed
    // floor slide under rapid direction changes.
    const prior = world.tryGet(e, PathFollow);
    const waypoints = pathToWaypoints(terrain, path);
    // If the entity is mid-tile when this route is issued — a RE-PATH while it was between cell centres
    // (e.g. a player move order interrupting a walk) — the first waypoint is the centre of the cell it is
    // ALREADY in, so following the path verbatim makes it visibly back UP to that centre before turning.
    // Drop that leading waypoint (when a next one exists) so it heads straight for the following cell. An
    // entity standing exactly on a centre — every AI-issued route, since the planner sets a goal only while
    // the unit is idle at a cell centre — keeps the full path, so the goldens are untouched.
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
};

/**
 * Turn a node path into the {@link PathFollow} waypoint list — half-cell node positions in
 * fixed-point tile units (`positionOfNode`), with one extra SEAM waypoint spliced into every
 * DIAGONAL leg that LEAVES AN ODD HALF-ROW. Such a leg spans rows `r±½ → r∓½` and crosses the
 * integer row mid-leg — exactly where the stagger's triangle wave kinks — so interpolating the grid
 * delta linearly would swing the mover a quarter-column sideways at the crossing. The seam is the
 * world-straight midpoint of the edge (`(hx₁+hx₂)/4` columns) expressed at the integer row it
 * crosses; with it each sub-leg stays inside one row interval, where linear grid motion IS straight
 * on screen. Every other edge needs no seam: E/W stays on one row, a half-row vertical and an
 * even-row diagonal stay inside a single row interval. Pure fixed-point.
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
  blocked: ReadonlySet<NodeId>,
): NodeId[] | null {
  if (!isValidNodeId(terrain, start) || !isValidNodeId(terrain, goal)) return null;
  return findPath(terrain, start as NodeId, goal as NodeId, blocked);
}
