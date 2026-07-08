import { PathFollow, PathRequest, Position } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import { HALF_COLUMN } from '../../nav/metric.js';
import { findPath } from '../../nav/pathfinding.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { System } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import { canonicalById, isValidCellId } from '../spatial.js';

// pathfindingSystem lives in routing.ts (not pathfinding.ts) to avoid an eyeball collision with the
// A* core in ../pathfinding.ts, which this system consumes. The cross-system `isValidCellId` guard comes
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
 * cell. On success it writes the cell sequence into the entity's {@link PathFollow} (cell centres in
 * fixed-point tile units, plus a seam waypoint inside each vertical step — {@link pathToWaypoints})
 * and removes the request; on failure it flags the request `failed` and
 * removes any stale path, leaving the request for the planner to inspect rather than silently
 * retrying the same dead query every tick. No-ops entirely when no terrain graph is present — a
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
  let blocked: ReadonlySet<CellId> | undefined;
  for (const e of canonicalById(world.query(PathRequest))) {
    if (served >= PATHFINDING_BUDGET_PER_TICK) break;
    const req = world.get(e, PathRequest);
    if (req.failed) continue; // already-failed requests aren't retried
    served++;

    blocked ??= dynamicBlockedCells(world, ctx, terrain);
    const path = resolvePath(terrain, req.start, req.goal, blocked);
    if (path === null) {
      req.failed = true; // signal the planner; keep the request so it isn't silently re-issued
      world.remove(e, PathFollow); // drop any stale path so movement doesn't follow a dead route
      continue;
    }

    // Success: hand the entity a fresh PathFollow of waypoints and clear the request.
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
    world.add(e, PathFollow, { waypoints, index: 0 });
    world.remove(e, PathRequest);
  }
};

/**
 * Turn a cell path into the {@link PathFollow} waypoint list — cell centres in fixed-point tile
 * units, with one extra SEAM waypoint spliced into every VERTICAL step (the two-row N/S lattice
 * edge). The seam is where the straight world-vertical line crosses the intermediate row: half a
 * column LEFT of the cells' shared world column when leaving an even row, half a column RIGHT when
 * leaving an odd one (the stagger's shift at the odd row). Without it the mover would interpolate
 * the grid delta linearly and the stagger's triangle wave would swing it half a column sideways at
 * the intermediate row — the very zigzag the vertical edge exists to remove; with it each sub-leg
 * stays inside one row interval, where linear grid motion IS straight on screen. Pure fixed-point.
 */
function pathToWaypoints(terrain: TerrainGraph, path: ReadonlyArray<CellId>): Array<{ x: Fixed; y: Fixed }> {
  const waypoints: Array<{ x: Fixed; y: Fixed }> = [];
  let prev: { x: number; y: number } | undefined;
  for (const cell of path) {
    const c = terrain.coordsOf(cell);
    if (prev !== undefined && Math.abs(c.y - prev.y) === 2) {
      // A vertical step (only the N/S edge spans two rows, and it never changes the column) — splice
      // the seam crossing so both sub-legs are world-straight. At the map's west border this seam can
      // sit at grid x = −0.5 (column 0, even row — the world-vertical line hugs the border cells'
      // outer edge): a legal transient position — every consumer clamps/truncates back into the grid.
      const midX =
        (prev.y & 1) === 0
          ? fx.sub(fx.fromInt(prev.x), HALF_COLUMN)
          : fx.add(fx.fromInt(prev.x), HALF_COLUMN);
      waypoints.push({ x: midX, y: fx.fromInt((prev.y + c.y) / 2) });
    }
    waypoints.push({ x: fx.fromInt(c.x), y: fx.fromInt(c.y) });
    prev = c;
  }
  return waypoints;
}

/**
 * Run A* for a request, guarding the raw cell ids against the graph bounds first. An id outside
 * `0..cellCount-1` is a bad request (e.g. a goal off a smaller map) — treat it as "no route"
 * (null) rather than letting it throw inside the heuristic, since a request is boundary input.
 */
function resolvePath(
  terrain: TerrainGraph,
  start: number,
  goal: number,
  blocked: ReadonlySet<CellId>,
): CellId[] | null {
  if (!isValidCellId(terrain, start) || !isValidCellId(terrain, goal)) return null;
  return findPath(terrain, start as CellId, goal as CellId, blocked);
}
