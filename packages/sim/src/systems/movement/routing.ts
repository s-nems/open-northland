import {
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  WalkFacing,
  type Waypoint,
} from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { positionOfNode, positionXOfWorld } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import { findPath, type SearchStats } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { ROW_STEP, worldDistance, worldX } from '../../nav/world-metric.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { isValidNodeId } from '../spatial/nodes.js';
import {
  ColliderWalkBlocks,
  hasBodyCollision,
  type UnitWalkBlocks,
  unitWalkBlocks,
} from './collision/index.js';
import { GroupRoutes } from './group-routes.js';
import { beginWalkTurn } from './turning.js';

/**
 * The pathfinder's per-tick work budget, in A*-settled nodes: what search time is proportional to.
 * Budgeting the cost rather than a request count lets a formation's cheap local routes land in one tick
 * while a single cross-map route still spreads. Approximation: a tick-time guard, not data-pinned.
 */
const PATHFINDING_NODE_BUDGET_PER_TICK = 16384;

/**
 * Drains pending path requests into followable paths, lowest entity id first until the tick's node budget
 * is spent, past which only group members borrowing a route served this tick still start. A route that
 * cannot be found flags the request for the planner rather than retrying silently.
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
  const groupRoutes = new GroupRoutes(terrain);
  const dynamicOnly = (): BlockOverlay => {
    dynamic ??= dynamicBlockOverlay(world, ctx, terrain);
    return dynamic;
  };
  const blockedFor = (player: number): BlockOverlay => {
    let view = combinedByPlayer.get(player);
    if (view === undefined) {
      units ??= unitWalkBlocks(world, ctx.content, terrain);
      view = new ColliderWalkBlocks(dynamicOnly(), units, player);
      combinedByPlayer.set(player, view);
    }
    return view;
  };
  try {
    for (const e of world.canonicalQuery(PathRequest)) {
      // Past the budget only a group member that borrows a route already served this tick still starts, so
      // a march whose first route spent the budget sets off together; every full search waits.
      const overBudget = spent.explored >= nodeBudget;
      if (overBudget && !world.has(e, PlayerOrder)) continue;
      const req = world.get(e, PathRequest);
      if (req.failed) continue;

      const collides = hasBodyCollision(world, ctx.content, e);
      const blocked = collides ? blockedFor(world.tryGet(e, Owner)?.player ?? -1) : dynamicOnly();
      // A goal blocked only by a standing unit is recoverable: re-aim at the nearest free node so a charge
      // fans out around a crowded target. Collider-only, since a ghost's goal must stay exact.
      let goal = req.goal;
      let standIn = false;
      if (
        collides &&
        goal !== req.start && // a walker already standing there has arrived, however crowded
        isValidNodeId(terrain, goal) &&
        blocked.has(goal) &&
        !dynamicOnly().has(goal)
      ) {
        const free = nearestUnblockedNode(terrain, goal, blocked, claimedStandIns);
        if (free !== null) {
          goal = free;
          standIn = true;
        }
      }
      // Only a player's order moves a group; economy walks keep their own exact routes.
      const group =
        world.has(e, PlayerOrder) && isValidNodeId(terrain, req.start) && isValidNodeId(terrain, goal);
      let path = group ? groupRoutes.borrow(blocked, req.start, goal, spent) : null;
      if (path === null) {
        if (overBudget) continue;
        path = resolvePath(terrain, req.start, goal, blocked, spent);
        if (path !== null && group) groupRoutes.offer(blocked, path);
      }
      if (path !== null && standIn) {
        claimedStandIns.add(goal);
        // Keep the intent in step with the delivered route, or the planner would re-route back at the
        // occupied original every tick.
        const goalIntent = world.tryMut(e, MoveGoal);
        if (goalIntent !== undefined) goalIntent.cell = goal;
      }
      if (path === null) {
        world.mut(e, PathRequest).failed = true;
        // A failed mid-walk reroute keeps the live path, so the walker plays its old route out and parks on
        // a cell centre rather than freezing mid-leg.
        continue;
      }

      const waypoints = pathToWaypoints(terrain, path);
      // Keep a route's start when it is still ahead of an active step: skipping it would also skip its
      // terrain and node charge. A start behind the new heading is bypassed rather than backing up;
      // a blocked start only permits escape, never a return to its centre.
      const previous = world.tryGet(e, PathFollow);
      const oldTarget = previous?.waypoints[previous.index];
      const oldStart = previous?.waypoints[previous.index - 1];
      const activeCost = previous?.legCost ?? 0;
      const position = world.tryGet(e, Position);
      const moved =
        oldStart !== undefined &&
        position !== undefined &&
        (position.x !== oldStart.x || position.y !== oldStart.y);
      const oldPace =
        activeCost > 0
          ? (previous?.legPace ??
            (moved && oldTarget !== undefined && oldStart !== undefined
              ? fx.divCeil(
                  worldDistance(oldStart.x, oldStart.y, oldTarget.x, oldTarget.y),
                  fx.fromInt(activeCost),
                )
              : undefined))
          : undefined;
      const index =
        waypoints.length < 2 ||
        (activeCost > 0 &&
          position !== undefined &&
          waypoints[0] !== undefined &&
          !blocked.has(waypoints[0].node) &&
          startIsAhead(position, waypoints))
          ? 0
          : 1;
      world.add(e, PathFollow, {
        waypoints,
        index,
        legTicks: activeCost > 0 ? (previous?.legTicks ?? 0) : 0,
        legCost: activeCost,
        legPace: oldPace,
        departureCharged: previous?.departureCharged,
      });
      const firstTarget = waypoints[index];
      if (position !== undefined && firstTarget !== undefined && world.has(e, WalkFacing)) {
        beginWalkTurn(world, e, position, firstTarget);
      }
      world.remove(e, PathRequest);
    }
  } finally {
    // The post counts are a shared scratch.
    units?.release();
  }
}

function startIsAhead(position: { x: Fixed; y: Fixed }, waypoints: readonly Waypoint[]): boolean {
  const start = waypoints[0];
  const next = waypoints[1];
  if (start === undefined || next === undefined) return false;
  const approachX = worldX(start.x, start.y) - worldX(position.x, position.y);
  const approachY = fx.mul(fx.sub(start.y, position.y), ROW_STEP);
  const outgoingX = worldX(next.x, next.y) - worldX(start.x, start.y);
  const outgoingY = fx.mul(fx.sub(next.y, start.y), ROW_STEP);
  // The outgoing vector spans one lattice step; the integer dot product needs no normalization.
  return approachX * outgoingX + approachY * outgoingY > 0;
}

/**
 * Turn a node path into the stops a walker steps between, each with the lattice node whose roughness
 * paces the step that leaves it. A diagonal lattice edge is two of the original's steps through the
 * node between its rows, so it gets its midpoint as a stop: the edge's world-straight middle, which is
 * also where the stagger's triangle wave kinks for a leg leaving an odd half-row, so interpolating each
 * half linearly in grid coordinates stays straight on screen. The midpoint's node is the original's own
 * neighbour there, an odd-row node half a column to +x of this lattice's (`hexNeighboursOf`).
 */
function pathToWaypoints(terrain: TerrainGraph, path: ReadonlyArray<NodeId>): Waypoint[] {
  const waypoints: Waypoint[] = [];
  let prev: { x: number; y: number } | undefined;
  for (const node of path) {
    const c = terrain.coordsOf(node);
    if (prev !== undefined && Math.abs(c.y - prev.y) === 2) {
      // (hy₁+hy₂)/4 is the row the leg's middle lies on; the middle's world x is (hx₁+hx₂)/4 columns, a
      // quarter and so exact in fixed point.
      const rowY = fx.fromInt((prev.y + c.y) / 4);
      const midWorldX = fx.div(fx.fromInt(prev.x + c.x), fx.fromInt(4));
      const midX = c.x > prev.x ? prev.x + (prev.y & 1) : prev.x + (prev.y & 1) - 1;
      waypoints.push({
        x: positionXOfWorld(midWorldX, rowY),
        y: rowY,
        node: terrain.nodeAt(midX, (prev.y + c.y) / 2),
      });
    }
    const p = positionOfNode(c.x, c.y);
    waypoints.push({ x: p.x, y: p.y, node });
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
