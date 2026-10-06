import {
  Engagement,
  Fleeing,
  MoveGoal,
  Obstructed,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  PlayerOrder,
  Position,
  pathLegTicks,
  StandIn,
  Stranded,
  WalkFacing,
  type Waypoint,
} from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { positionOfNode, positionXOfWorld } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import { findPath, type SearchStats } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import { ROW_STEP, worldDistance, worldX } from '../../nav/world-metric.js';
import type { System, SystemContext } from '../context.js';
import { type WalkBlockMask, walkBlockMask } from '../footprint/walk-block-mask.js';
import { routeFound } from '../settlers/lost-way.js';
import { isValidNodeId } from '../spatial/nodes.js';
import {
  ColliderWalkBlocks,
  hasBodyCollision,
  type UnitWalkBlocks,
  unitWalkBlocks,
} from './collision/index.js';
import { GroupReachability } from './group-reachability.js';
import { GroupRoutes } from './group-routes.js';
import { dropPath, liveStepEnd, restartLeg } from './nav-state.js';
import { type RouteMemo, routeMemoOf } from './route-memo.js';
import { routeStartCell } from './route-start.js';
import { settlerTraversal } from './traversal.js';
import { beginWalkTurn } from './turning.js';

/**
 * The pathfinder's per-tick work budget, in A*-settled nodes: what search time is proportional to.
 * Autonomous walks share this budget. Player orders drain in their application tick, borrowing nearby
 * routes where possible. Approximation: a tick-time guard, not data-pinned.
 */
const PATHFINDING_NODE_BUDGET_PER_TICK = 16384;

/**
 * Drains pending path requests into followable paths, lowest entity id first until the tick's node budget
 * is spent; player orders still route after it is spent. A route that cannot be found flags the request
 * for the planner rather than retrying silently.
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
  // `dynamic` is the mask's levelled view, which skips the per-read level check; each request levels it
  // once before reading it, since the previous request's writes may have moved the version.
  let mask: WalkBlockMask | undefined;
  let dynamic: BlockOverlay | undefined;
  let units: UnitWalkBlocks | undefined;
  const combinedByPlayer = new Map<number, BlockOverlay>();
  // Goal stand-ins already handed out this tick, so two walkers aimed at one crowded node fan out to
  // different free nodes instead of both claiming the same one.
  const claimedStandIns = new Set<NodeId>();
  const groupRoutes = new GroupRoutes(terrain);
  const groupReachability = new GroupReachability(terrain);
  // Colliders only: a firm body that stalls in a crowd asks for the route it walks again, while a ghost's
  // repeats are too rare to pay for logging its searches.
  const memo = routeMemoOf(world, terrain);
  const dynamicOnly = (): BlockOverlay => {
    if (dynamic === undefined) {
      mask = walkBlockMask(world, ctx, terrain);
      dynamic = mask.levelled();
    }
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
  for (const e of world.canonicalQuery(PathRequest)) {
    // A player order must not trickle into motion in entity-id order. Sharing cuts its search cost,
    // but a member too far from a corridor still receives its own route in this tick.
    const playerOrdered = world.has(e, PlayerOrder);
    const overBudget = spent.explored >= nodeBudget;
    if (overBudget && !playerOrdered) continue;
    const req = world.get(e, PathRequest);
    if (req.failed) continue;
    if (req.grind && movedSinceGrindAsk(world, terrain, e, req.start)) {
      // The walker moved on while the ask waited: it made progress, so it keeps its route.
      world.remove(e, PathRequest);
      continue;
    }
    mask?.catchUp();

    const traversal = settlerTraversal(world, e);
    const collides = traversal === 'land' && hasBodyCollision(world, ctx.content, e);
    const blocked = collides ? blockedFor(world.tryGet(e, Owner)?.player ?? -1) : dynamicOnly();
    // A grind reroute plans as if its live route were already dropped, which it is unless the answer matches.
    const stepEnd =
      req.retainRoute || req.grind || !finishesStepOnReroute(world, e)
        ? undefined
        : freeStepEnd(world, terrain, e, blocked);
    const start = stepEnd ?? req.start;
    // A goal blocked only by a standing unit is recoverable: re-aim at the nearest free node so a charge
    // fans out around a crowded target. Collider-only, since a ghost's goal must stay exact.
    let goal = req.goal;
    let standIn = false;
    if (
      collides &&
      goal !== start && // a walker already standing there has arrived, however crowded
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
      traversal === 'land' &&
      playerOrdered &&
      isValidNodeId(terrain, start) &&
      isValidNodeId(terrain, goal);
    const unreachable =
      group && mask !== undefined && groupReachability.unreachable(mask, blocked, start, goal);
    let path = group && !unreachable ? groupRoutes.borrow(blocked, start, goal, spent) : null;
    if (path === null && !unreachable) {
      path = collides
        ? memoPath(memo, e, ctx.tick, start, goal, world.tryGet(e, Owner)?.player ?? -1, blocked, spent)
        : resolvePath(terrain, start, goal, blocked, spent, traversal);
      if (path !== null && group) groupRoutes.offer(blocked, path);
      if (path === null && group && mask !== undefined && !blocked.has(goal))
        groupReachability.rememberFailure(mask, blocked, start, goal);
    }
    if (path !== null) {
      if (standIn) {
        claimedStandIns.add(goal);
        // Keep the intent in step with the delivered route, or the planner would re-route back at the
        // occupied original every tick; the drive learns where it was stood in from the marker.
        const goalIntent = world.tryMut(e, MoveGoal);
        if (goalIntent !== undefined) goalIntent.cell = goal;
        world.add(e, StandIn, { goal: req.goal, at: goal });
      } else {
        world.remove(e, StandIn);
      }
    }
    let waypoints = path === null ? [] : pathToWaypoints(terrain, path);
    // A grind reroute that found the route already walked keeps it; any other answer replaces it.
    if (req.grind) {
      if (path !== null && walksRoute(world, e, waypoints)) {
        holdGrindRoute(world, e);
        continue;
      }
      dropPath(world, e);
    }
    if (path === null) {
      world.mut(e, PathRequest).failed = true;
      // A failed mid-walk reroute keeps the live path, so the walker plays its old route out and parks on a
      // cell centre rather than freezing mid-leg. A failed grind ask has already dropped it.
      continue;
    }

    // Keep a route's start when it is still ahead of an active step: skipping it would also skip its
    // terrain and node charge. A start behind the new heading is bypassed rather than backing up;
    // a blocked start only permits escape, never a return to its centre.
    const previous = world.tryGet(e, PathFollow);
    const previousStops = world.tryGet(e, PathRoute)?.waypoints;
    // A topology reroute starts at the end of the retained safe prefix. Finish that prefix
    // before the detour, including any diagonal midpoint on the way back from a closed edge.
    if (req.retainRoute && previous !== undefined && previousStops?.at(-1)?.node === req.start) {
      world.mut(e, PathRoute).waypoints = [...previousStops, ...waypoints.slice(1)];
      endGrindHold(world, e);
      settleRoute(world, e, req.goal);
      continue;
    }
    const oldTarget = previous && previousStops?.[previous.index];
    const oldStart = previous && previousStops?.[previous.index - 1];
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
    // A walker partway through a step finishes it along its edge before the new route, however sharply
    // that route then turns.
    const finishesStep = moved && stepEnd !== undefined && waypoints[0]?.node === stepEnd;
    let index =
      waypoints.length < 2 ||
      finishesStep ||
      (activeCost > 0 &&
        position !== undefined &&
        waypoints[0] !== undefined &&
        !blocked.has(waypoints[0].node) &&
        startIsAhead(position, waypoints))
        ? 0
        : 1;
    // Keep the departed leg in the route history when its new start is still ahead. A later
    // closure needs that history to turn back safely, including the far half of a diagonal.
    if (index === 0 && oldStart !== undefined && previous !== undefined) {
      const centre = positionOfNode(terrain.xOf(oldStart.node), terrain.yOf(oldStart.node));
      const before = previousStops?.[previous.index - 2];
      const history =
        before !== undefined && (oldStart.x !== centre.x || oldStart.y !== centre.y)
          ? [before, oldStart]
          : [oldStart];
      waypoints = [...history, ...waypoints];
      index = history.length;
    }
    world.add(e, PathRoute, { waypoints });
    endGrindHold(world, e);
    world.add(e, PathFollow, {
      index,
      legElapsed: activeCost > 0 && previous !== undefined ? pathLegTicks(previous, ctx.tick - 1) : 0,
      legCost: activeCost,
      legPace: oldPace,
      departureCharged: previous?.departureCharged,
      bootsDegree: previous?.bootsDegree,
    });
    const firstTarget = waypoints[index];
    if (position !== undefined && firstTarget !== undefined && world.has(e, WalkFacing)) {
      beginWalkTurn(world, e, position, firstTarget);
    }
    settleRoute(world, e, req.goal);
  }
  memo.expire(ctx.tick);
}

/** A route installed answers its request and ends any stranded park; one to the work a lost settler
 *  waited on is its way found. */
function settleRoute(world: World, e: Entity, goal: NodeId): void {
  world.remove(e, PathRequest);
  world.remove(e, Stranded);
  routeFound(world, e, goal);
}

/** Whether `e` still walks a route but no longer stands nearest `start`, the node its grind ask is from. */
function movedSinceGrindAsk(world: World, terrain: TerrainGraph, e: Entity, start: NodeId): boolean {
  const p = world.tryGet(e, Position);
  if (p === undefined || !world.has(e, PathFollow)) return false;
  return routeStartCell(terrain, p.x, p.y, settlerTraversal(world, e)) !== start;
}

/** A hold covers only the route a grind ask kept: any route routing installs asks at its next stall. */
function endGrindHold(world: World, e: Entity): void {
  if ((world.tryGet(e, Obstructed)?.hold ?? 0) > 0) world.mut(e, Obstructed).hold = 0;
}

/** Whether `waypoints` is the tail of the route `e` walks from its live leg's start, so taking it would aim
 *  the walker at the target it already walks toward. */
function walksRoute(world: World, e: Entity, waypoints: readonly Waypoint[]): boolean {
  const follow = world.tryGet(e, PathFollow);
  const stops = world.tryGet(e, PathRoute)?.waypoints;
  if (follow === undefined || stops === undefined || waypoints.length < 2) return false;
  const offset = follow.index - 1;
  if (offset < 0 || stops.length - offset !== waypoints.length) return false;
  for (let i = 0; i < waypoints.length; i++) {
    const held = stops[offset + i];
    const found = waypoints[i];
    if (held === undefined || found === undefined) return false;
    if (held.node !== found.node || held.x !== found.x || held.y !== found.y) return false;
  }
  return true;
}

/** Keep the route a grind reroute found unchanged, restarting its leg as a fresh install would; the walker
 *  then waits out as many windows as it has ground through before asking again. */
function holdGrindRoute(world: World, e: Entity): void {
  restartLeg(world, e);
  world.remove(e, PathRequest);
  world.remove(e, Stranded);
  const obstruction = world.tryMut(e, Obstructed);
  if (obstruction !== undefined) obstruction.hold = obstruction.reroutes;
}

/** Whether `e` finishes its live step before taking a new route: a player's walk and a run from danger,
 *  whose re-aims a click or a threat can repeat every few ticks. A chase, an attack-move's included, keeps
 *  cutting toward its target, which lets a crowd settle round an enemy without walking each step out first. */
function finishesStepOnReroute(world: World, e: Entity): boolean {
  if (world.has(e, Engagement)) return false;
  return world.has(e, PlayerOrder) || world.has(e, Fleeing);
}

/**
 * The node ending the step `e` is partway through, when it is free to route from. Starting there keeps the
 * walker on the lattice: from the middle of an edge it would otherwise cut toward the new route's second
 * node, a heading its facing and walk clip cannot show. Undefined for a walker standing on a node.
 * Approximation of the original, whose walk is an atomic one-step action; whether an order can cut that
 * step short is unconfirmed.
 */
function freeStepEnd(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  blocked: BlockOverlay,
): NodeId | undefined {
  const follow = world.tryGet(e, PathFollow);
  const stops = world.tryGet(e, PathRoute)?.waypoints;
  const p = world.tryGet(e, Position);
  if (follow === undefined || stops === undefined || p === undefined) return undefined;
  const from = stops[follow.index - 1];
  if (from === undefined || (from.x === p.x && from.y === p.y)) return undefined;
  const end = liveStepEnd(terrain, follow.index, stops);
  const node = end === undefined ? undefined : stops[end]?.node;
  return node === undefined || blocked.has(node) ? undefined : node;
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
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (node === undefined) continue;
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    if (i > 0 && Math.abs(y - prevY) === 2) {
      // (hy₁+hy₂)/4 is the row the leg's middle lies on; the middle's world x is (hx₁+hx₂)/4 columns, a
      // quarter and so exact in fixed point.
      const rowY = fx.fromInt((prevY + y) / 4);
      const midWorldX = fx.div(fx.fromInt(prevX + x), fx.fromInt(4));
      const midX = x > prevX ? prevX + (prevY & 1) : prevX + (prevY & 1) - 1;
      waypoints.push({
        x: positionXOfWorld(midWorldX, rowY),
        y: rowY,
        node: terrain.nodeAt(midX, (prevY + y) / 2),
      });
    }
    const p = positionOfNode(x, y);
    waypoints.push({ x: p.x, y: p.y, node });
    prevX = x;
    prevY = y;
  }
  return waypoints;
}

/** {@link resolvePath} through the route memo, for a collider seen as `player`. */
function memoPath(
  memo: RouteMemo,
  e: Entity,
  tick: number,
  start: number,
  goal: number,
  player: number,
  blocked: BlockOverlay,
  stats: SearchStats,
): NodeId[] | null {
  if (!isValidNodeId(memo.terrain, start) || !isValidNodeId(memo.terrain, goal)) return null;
  return memo.route(e, tick, start, goal, player, blocked, stats);
}

/** Run A* for a request; an off-grid `start` or `goal` reads as no route. */
function resolvePath(
  terrain: TerrainGraph,
  start: number,
  goal: number,
  blocked: BlockOverlay,
  stats: SearchStats,
  traversal: Traversal,
): NodeId[] | null {
  if (!isValidNodeId(terrain, start) || !isValidNodeId(terrain, goal)) return null;
  return findPath(terrain, start, goal, blocked, stats, traversal);
}
