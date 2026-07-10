import { MoveGoal, PathFollow, PathRequest, Position } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { worldDistance, worldX } from '../../nav/metric.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import { isValidNodeId } from '../spatial.js';

const TWO: Fixed = fx.fromInt(2);

/** The integer FLOOR of a Fixed. `fx.toInt` truncates toward zero, which is one too high for a
 *  negative fraction — reachable here: a west-border seam transient can sit a quarter-column left
 *  of world x = 0 (`routing.ts` pathToWaypoints), and the bracket below must be the true
 *  floor/ceil pair. */
function floorInt(v: Fixed): number {
  const t = fx.toInt(v);
  return v < fx.fromInt(t) ? t - 1 : t;
}

/**
 * The route-start node for a walker standing at fixed-point position `(x,y)`: the nearest WALKABLE
 * node among the (up to four) nodes that bracket the position on the rectangular half-cell lattice
 * (floor/ceil of its world coordinates in half-cell units), by world-metric distance (ties by
 * ascending cell id — deterministic; a bracket node clamped onto the map at a border can duplicate
 * another, which is harmless — identical distance and id). Mid-leg a walker sits between two
 * walkable waypoints, so the bracket always contains a walkable node — but the NEAREST bracket node
 * alone can be unwalkable: a diagonal leg is legal with one impassable flank (see `terrain.ts`
 * steps), and a walker past the seam truncates onto that flank. `findPath` rejects an unwalkable
 * start outright, which would fail the request and strand the walker mid-seam; skipping to the
 * nearest WALKABLE bracket node keeps every mid-walk re-route servable. Falls back to the
 * truncated node if no bracket node is walkable — the request then fails exactly as an off-network
 * start always has.
 */
function routeStartCell(terrain: TerrainGraph, x: Fixed, y: Fixed): NodeId {
  // World coordinates in half-cell units — the lattice is rectangular in world space, so the
  // nearest node is one of the four floor/ceil corners of (2·worldX, 2·row).
  const wx = fx.mul(worldX(x, y), TWO);
  const wy = fx.mul(y, TWO);
  const lowX = floorInt(wx);
  const lowY = floorInt(wy);
  const cols = wx === fx.fromInt(lowX) ? [lowX] : [lowX, lowX + 1];
  const rows = wy === fx.fromInt(lowY) ? [lowY] : [lowY, lowY + 1];
  let best: NodeId | undefined;
  let bestD: Fixed | undefined;
  for (const col of cols) {
    for (const row of rows) {
      const cell = terrain.nodeAtClamped(col, row);
      if (!terrain.isWalkable(cell)) continue;
      const c = terrain.coordsOf(cell);
      const centre = positionOfNode(c.x, c.y);
      const d = worldDistance(x, y, centre.x, centre.y);
      if (bestD === undefined || d < bestD || (d === bestD && best !== undefined && cell < best)) {
        best = cell;
        bestD = d;
      }
    }
  }
  if (best !== undefined) return best;
  const n = nodeOfPosition(x, y);
  return terrain.nodeAtClamped(n.hx, n.hy);
}

/**
 * The navigation planner: turn a {@link MoveGoal} on a request-less entity into a
 * {@link PathRequest} from the entity's nearest cell to the goal cell. The PathfindingSystem turns
 * that into a path and the MovementSystem walks it; when the entity stands on the goal centre the
 * goal is satisfied and removed. An entity already walking a route that ENDS at the goal is left to
 * play it out; a route that ends anywhere else is stale — the goal changed mid-walk (a player
 * redirect) — and is re-routed immediately from where the walker stands, so the routing splice
 * replaces the path in the same tick and carries the walker's momentum through the turn
 * (`routing.ts`/`movement.ts` — the movement-inertia corner rule). A goal whose request just failed
 * (no route) is left in place but not re-issued this tick — the failed flag is the planner's
 * signal; a future slice decides abandon/wait/repath. This is the *where* layer; the atomic planner
 * (the *what*) sets the goals.
 *
 * Determinism: no RNG, no wall-clock; entities are visited in the deterministic MoveGoal store
 * order, and the action (issue a request, or remove a satisfied goal) is a pure function of the
 * entity's position, path and goal.
 */
export function navigationPlanner(world: World, terrain: TerrainGraph): void {
  for (const e of world.query(Position, MoveGoal)) {
    // A route is already being resolved — let it land (or fail) before deciding anything.
    if (world.has(e, PathRequest)) continue;

    const goalNode = world.get(e, MoveGoal).cell;
    if (!isValidNodeId(terrain, goalNode)) {
      // An unreachable/off-map goal can never be satisfied; drop it rather than issue dead requests
      // every tick. (A planner that owns the goal can re-add a valid one.)
      world.remove(e, MoveGoal);
      continue;
    }

    const p = world.get(e, Position);
    const pf = world.tryGet(e, PathFollow);
    if (pf !== undefined) {
      // The steady-state majority (already walking the right route) exits HERE every tick — keep it
      // allocation-free: a route's LAST waypoint is always an exact node centre (`routing.ts`), so
      // comparing its node is bit-equivalent to comparing centre coordinates.
      const last = pf.waypoints[pf.waypoints.length - 1];
      if (last !== undefined) {
        const n = nodeOfPosition(last.x, last.y);
        if (terrain.nodeAtClamped(n.hx, n.hy) === goalNode) {
          continue; // route serves the goal
        }
      }
      // The route ends somewhere else — the goal changed mid-walk. Fall through and re-route from
      // where the walker stands: the splice replaces the stale path this tick, momentum carried.
    } else {
      const g = terrain.coordsOf(goalNode as NodeId); // validated just above
      const centre = positionOfNode(g.x, g.y);
      if (p.x === centre.x && p.y === centre.y) {
        world.remove(e, MoveGoal); // standing exactly on the goal node: satisfied
        continue;
      }
    }

    // Route from the nearest WALKABLE bracket cell (see routeStartCell), not the truncated one.
    // Truncation binds a walker to the centre BEHIND it for its whole leg, so a mid-leg redirect
    // routed from that stale centre and visibly backtracked through it; the nearest centre keeps the
    // spliced first leg short and forward. (A start === goal request yields the single-cell path
    // that centres the walker.)
    world.add(e, PathRequest, { start: routeStartCell(terrain, p.x, p.y), goal: goalNode, failed: false });
  }
}
