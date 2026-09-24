import { MoveGoal, PathFollow, PathRequest, PathRoute, Position } from '../../../components/index.js';
import { type Fixed, fx } from '../../../core/fixed.js';
import type { World } from '../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { worldDistance, worldX } from '../../../nav/world-metric.js';
import { isValidNodeId } from '../../spatial/nodes.js';

const TWO: Fixed = fx.fromInt(2);

/** The integer floor of a Fixed. `fx.toInt` truncates toward zero, which is one too high for a negative
 *  fraction, and a west-border seam transient can sit a quarter-column left of world x = 0. */
function floorInt(v: Fixed): number {
  const t = fx.toInt(v);
  return v < fx.fromInt(t) ? t - 1 : t;
}

/**
 * The route-start node for a walker at fixed-point position `(x,y)`: the nearest walkable node among
 * the four that bracket the position on the half-cell lattice, by world-metric distance with ascending
 * cell id as the tie-break. The nearest bracket node alone can be unwalkable, since a diagonal leg is
 * legal with one impassable flank, and `findPath` rejects an unwalkable start outright, which would
 * strand the walker mid-seam. Falls back to the truncated node when no bracket node is walkable.
 */
function routeStartCell(terrain: TerrainGraph, x: Fixed, y: Fixed): NodeId {
  // World coordinates in half-cell units: the lattice is rectangular in world space, so the nearest
  // node is one of the four floor/ceil corners of (2·worldX, 2·row).
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
 * Turn a {@link MoveGoal} on a request-less entity into a {@link PathRequest} from the entity's nearest
 * cell to the goal cell, and remove a goal the entity already stands on. An entity walking a route that
 * ends at the goal plays it out; a route ending anywhere else is stale and is re-routed from where the
 * walker stands, so the splice replaces the path in the same tick and carries its momentum through the
 * turn. A goal whose request just failed is left in place and not re-issued: the failed flag is the
 * signal the owning drive reads.
 */
export function navigationPlanner(world: World, terrain: TerrainGraph): void {
  for (const e of world.query(Position, MoveGoal)) {
    // A route is already being resolved - let it land (or fail) before deciding anything.
    if (world.has(e, PathRequest)) continue;

    const goalNode = world.get(e, MoveGoal).cell;
    if (!isValidNodeId(terrain, goalNode)) {
      // An off-map goal can never be satisfied, so drop it rather than issue dead requests every tick.
      world.remove(e, MoveGoal);
      continue;
    }

    const p = world.get(e, Position);
    if (world.has(e, PathFollow)) {
      // A route's last waypoint is always an exact node centre, so comparing its node is equivalent to
      // comparing centre coordinates and keeps this steady-state exit allocation-free.
      const stops = world.get(e, PathRoute).waypoints;
      const last = stops[stops.length - 1];
      if (last !== undefined) {
        const n = nodeOfPosition(last.x, last.y);
        if (terrain.nodeAtClamped(n.hx, n.hy) === goalNode) {
          continue; // route serves the goal
        }
      }
      // The route ends somewhere else, so the goal changed mid-walk: fall through and re-route.
    } else {
      const g = terrain.coordsOf(goalNode); // validated just above
      const centre = positionOfNode(g.x, g.y);
      if (p.x === centre.x && p.y === centre.y) {
        world.remove(e, MoveGoal); // standing exactly on the goal node: satisfied
        continue;
      }
    }

    // Routing from the nearest walkable bracket cell rather than the truncated one keeps a spliced
    // first leg short and forward, since truncation binds a walker to the centre behind it.
    world.add(e, PathRequest, { start: routeStartCell(terrain, p.x, p.y), goal: goalNode, failed: false });
  }
}
