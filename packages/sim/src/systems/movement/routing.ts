import { MoveGoal, Owner, PathFollow, PathRequest, Position } from '../../components/index.js';
import { type Fixed, fx, ZERO } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import { LayeredBlocks } from '../../nav/block-overlay.js';
import { positionOfNode, positionXOfWorld } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import { findPath, type SearchStats } from '../../nav/pathfinding.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import { canonicalById, isValidNodeId } from '../spatial.js';
import { hasBodyCollision, type UnitWalkBlocks, unitWalkBlocks } from './collision/index.js';
import { turnOntoNextLeg } from './movement.js';

// pathfindingSystem lives in routing.ts (not pathfinding.ts) to avoid an eyeball collision with the
// A* core in ../pathfinding.ts, which this system consumes. The cross-system `isValidNodeId` guard comes
// from the shared leaf.

/**
 * The pathfinder's per-tick work budget, in A*-SETTLED NODES ({@link SearchStats.explored}) — the
 * unit search time is actually proportional to. Budgeting the COST (not a request count) is what
 * lets crowd orders start together: a battle-scale chase settles ~30–150 nodes, so a couple of
 * hundred fighters route in ONE tick, while a single cross-map route settling thousands still
 * spreads over ticks — the old fixed count of 8 made a hundred-strong front start walking in a
 * visible half-second top-to-bottom wave (spawn rows = id order), which read as a bug, yet allowed
 * eight map-long floods in one tick. The budget is a soft ceiling checked BEFORE each request (the
 * one that overshoots still completes, so every tick makes progress); serving stays lowest-entity-
 * id-first, never a wall-clock cutoff, and explored counts are themselves deterministic — the
 * spread is lockstep-safe. The magnitude is a tick-time guard (~a few ms of search on a modern
 * core), not data-pinned: tune against profiles as maps and armies grow.
 */
export const PATHFINDING_NODE_BUDGET_PER_TICK = 16384;

/**
 * PathfindingSystem — drains pending {@link PathRequest}s and turns each into a followable path.
 *
 * Requests are served lowest entity id first until the tick's search-work budget
 * ({@link PATHFINDING_NODE_BUDGET_PER_TICK}, in A*-settled nodes) is spent — a cost cut, not a
 * request count, so a whole formation's cheap local routes land in one tick while expensive long
 * routes still spread (see the constant). For each served request it runs A* on `ctx.terrain` from
 * the request's `start` to `goal` cell. On success it writes the node sequence into the entity's
 * {@link PathFollow} (half-cell node positions in fixed-point tile units, plus a seam waypoint
 * inside each odd-row diagonal leg — {@link pathToWaypoints})
 * and removes the request; on failure it flags the request `failed` — keeping any live path, so a
 * failed mid-walk reroute parks the walker on a node centre instead of freezing it mid-leg — and
 * leaves the request for the planner to inspect rather than silently retrying the same dead query
 * every tick. No-ops entirely when no terrain graph is present — a
 * mapless sim (the determinism golden) has nothing to route over.
 *
 * Determinism: A* is pure and canonically tie-broken; requests are served in ascending entity-id
 * order (a canonical sort, not Map insertion order) with a deterministic cost cut (explored counts
 * are pure functions of the query); cell ids are validated against the graph so an out-of-range
 * request fails gracefully instead of throwing inside the search.
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
  // Serve in ascending entity-id order so the per-tick budget cut is canonical (never insertion
  // order). Scan only the entities that HAVE a request (canonicalById over the query yields the same
  // ascending-id subsequence a full canonicalEntities() filter did — store ⊆ alive), so a tick with
  // no requests costs O(requests), not O(world).
  const spent: SearchStats = { explored: 0 };
  // The walk-block overlays, built lazily ONCE per routing tick — only a tick that actually routes
  // pays for them. `dynamic` is the standing building bodies + resource footprints — every
  // requester sees it. `units` is the standing-collider stamp (see `unitWalkBlocks` — routing sees
  // standing bodies, never moving ones), and it applies ONLY to a requester that itself collides
  // (`hasBodyCollision`): a ghost walks straight through bodies, so detouring it — or re-aiming its
  // goal off an occupied node — would break the economy's exact node-coincidence walks (the shared
  // policy on `hasBodyCollision`). For a collider the two compose per REQUESTER player — another
  // player's town posts block me, its own never block it — as a LAYERED membership view (the
  // per-player union used to copy the whole `dynamic` set every tick), memoized per player id seen
  // this tick (-1 = an unowned collider, which no player's town exempts).
  let dynamic: ReadonlySet<NodeId> | undefined;
  let units: UnitWalkBlocks | undefined;
  const combinedByPlayer = new Map<number, BlockOverlay>();
  // Goal stand-ins already handed out this tick, so two walkers aimed at one crowded node fan out
  // to DIFFERENT free nodes (the surround rule) instead of both claiming the same one.
  const claimedStandIns = new Set<NodeId>();
  const dynamicOnly = (): ReadonlySet<NodeId> => {
    dynamic ??= dynamicBlockedCells(world, ctx, terrain);
    return dynamic;
  };
  const blockedFor = (player: number): BlockOverlay => {
    let view = combinedByPlayer.get(player);
    if (view === undefined) {
      const base = dynamicOnly();
      units ??= unitWalkBlocks(world, terrain, ctx.tick);
      const layers: Array<ReadonlySet<NodeId>> = [base, units.field];
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
      // A goal occupied by a STANDING UNIT (in the unit stamp but not a wall/resource) is a live,
      // recoverable situation — someone is simply standing there. Re-aim at the nearest free node
      // instead of failing: this is the rule that fans a charge out AROUND a crowded target (each
      // arrival stands, occupies its node, and the next walker is dealt the next free one).
      // Collider-only, like the overlay itself: a ghost's goal must stay EXACT.
      const goal = req.goal;
      if (blocked.has(goal) && !(dynamic?.has(goal) ?? false)) {
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
}

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
  blocked: BlockOverlay,
  stats: SearchStats,
): NodeId[] | null {
  if (!isValidNodeId(terrain, start) || !isValidNodeId(terrain, goal)) return null;
  return findPath(terrain, start as NodeId, goal as NodeId, blocked, stats);
}
