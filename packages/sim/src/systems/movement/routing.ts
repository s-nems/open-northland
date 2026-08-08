import { MoveGoal, Owner, PathFollow, PathRequest, Position } from '../../components/index.js';
import { type Fixed, fx, ZERO } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import { type BlockOverlay, LayeredBlocks } from '../../nav/block-overlay.js';
import { positionOfNode, positionXOfWorld } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import { findPath, type SearchStats } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockLayers, dynamicBlockOverlay } from '../footprint/index.js';
import { canonicalById, isValidNodeId } from '../spatial/nodes.js';
import { hasBodyCollision, type UnitWalkBlocks, unitWalkBlocks } from './collision/index.js';
import { turnOntoNextLeg } from './stepping.js';

/**
 * The pathfinder's per-tick work budget, in A*-settled nodes: what search time is proportional to.
 * Budgeting the cost rather than a request count lets a formation's cheap local routes land in one tick
 * while a single cross-map route still spreads. Approximation: a tick-time guard, not data-pinned.
 */
const PATHFINDING_NODE_BUDGET_PER_TICK = 16384;

/**
 * Drains pending path requests into followable paths, lowest entity id first until the tick's node budget
 * is spent. A route that cannot be found flags the request for the planner rather than retrying silently.
 */
export const pathfindingSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: nothing to route over
  drainPathRequests(world, ctx, terrain, PATHFINDING_NODE_BUDGET_PER_TICK);
};

/**
 * The request-serving pass with an explicit `nodeBudget`, so a test can exercise the budget cut. The
 * budget is checked before each request and the overshooting one still completes, so a tick always
 * serves at least one pending request.
 */
export function drainPathRequests(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  nodeBudget: number,
): void {
  // Serve in ascending entity-id order so the per-tick budget cut is canonical, never insertion order.
  const spent: SearchStats = { explored: 0 };
  // Walk-block overlays, built lazily so only a tick that actually routes pays for them. The standing-unit
  // stamp applies only to a requester that itself collides: a ghost walks through bodies, and detouring it
  // would break the economy's exact node-coincidence walks. Player -1 keys an unowned collider.
  let dynamic: BlockOverlay | undefined;
  let units: UnitWalkBlocks | undefined;
  const combinedByPlayer = new Map<number, BlockOverlay>();
  // Goal stand-ins already handed out this tick, so two walkers aimed at one crowded node fan out to
  // different free nodes instead of both claiming the same one.
  const claimedStandIns = new Set<NodeId>();
  const dynamicOnly = (): BlockOverlay => {
    dynamic ??= dynamicBlockOverlay(world, ctx, terrain);
    return dynamic;
  };
  const blockedFor = (player: number): BlockOverlay => {
    let view = combinedByPlayer.get(player);
    if (view === undefined) {
      units ??= unitWalkBlocks(world, ctx.content, terrain);
      const layers: Array<ReadonlySet<NodeId>> = [...dynamicBlockLayers(world, ctx, terrain), units.field];
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
    if (req.failed) continue;

    const collides = hasBodyCollision(world, ctx.content, e);
    const blocked = collides ? blockedFor(world.tryGet(e, Owner)?.player ?? -1) : dynamicOnly();
    let path = resolvePath(terrain, req.start, req.goal, blocked, spent);
    if (path === null && collides && isValidNodeId(terrain, req.goal)) {
      // A goal blocked only by a standing unit is recoverable: re-aim at the nearest free node so a charge
      // fans out around a crowded target. Collider-only, since a ghost's goal must stay exact.
      const goal = req.goal;
      if (blocked.has(goal) && !dynamicOnly().has(goal)) {
        const standIn = nearestUnblockedNode(terrain, goal, blocked, claimedStandIns);
        if (standIn !== null) {
          path = resolvePath(terrain, req.start, standIn, blocked, spent);
          if (path !== null) {
            claimedStandIns.add(standIn);
            // Keep the intent in step with the delivered route, or the planner would re-route back
            // at the occupied original every tick.
            const goalIntent = world.tryMut(e, MoveGoal);
            if (goalIntent !== undefined) goalIntent.cell = standIn;
          }
        }
      }
    }
    if (path === null) {
      world.mut(e, PathRequest).failed = true;
      // A failed mid-walk reroute keeps the live path, so the walker plays its old route out and parks on
      // a cell centre rather than freezing mid-leg.
      continue;
    }

    // A reroute carries the walking entity's gait and heading over onto the new first leg.
    const prior = world.tryGet(e, PathFollow);
    const waypoints = pathToWaypoints(terrain, path);
    // A route issued mid-tile starts at the centre of the cell the entity already occupies, so following it
    // verbatim backs the entity up before it turns. Drop that leading waypoint; an entity standing on a
    // centre keeps the full path.
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
    // Turn any carried momentum onto the first leg; from rest the (0, 0) sentinel only records the heading.
    if (p !== undefined) turnOntoNextLeg(follow, p);
    world.add(e, PathFollow, follow);
    world.remove(e, PathRequest);
  }
}

/**
 * Turn a node path into half-cell waypoint positions in fixed-point tile units, splicing a seam waypoint
 * into every diagonal leg that leaves an odd half-row. Such a leg crosses the integer row where the
 * stagger's triangle wave kinks, so interpolating the grid delta linearly would swing the mover a
 * quarter-column sideways; the seam is the world-straight midpoint of the edge at that row. Every other
 * edge stays inside one row interval, where linear grid motion is straight on screen.
 */
function pathToWaypoints(terrain: TerrainGraph, path: ReadonlyArray<NodeId>): Array<{ x: Fixed; y: Fixed }> {
  const waypoints: Array<{ x: Fixed; y: Fixed }> = [];
  let prev: { x: number; y: number } | undefined;
  for (const cell of path) {
    const c = terrain.coordsOf(cell);
    if (prev !== undefined && Math.abs(c.y - prev.y) === 2 && (prev.y & 1) === 1) {
      // (hy₁+hy₂)/4 is the integer row the leg crosses; the edge midpoint's world x is (hx₁+hx₂)/4
      // columns, a quarter and so exact in fixed point.
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

/** Run A* for a request; an off-grid `start` or `goal` reads as no route. */
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
