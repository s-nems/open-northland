import type { BlockOverlay } from '../../nav/block-overlay.js';
import { joinCorridor } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import { GROUP_AREA_RADIUS_NODES, SHARED_ROUTE_MIN_NODES } from '../movement/group-routes.js';

interface OrderRoute {
  readonly group: string;
  readonly path: readonly NodeId[];
}

/**
 * One command pass's long goto routes. A group order is one goto per vehicle, so a vehicle of the same
 * group (owner, traversal, hull size) that leaves from near where another's route starts and heads to
 * near where it ends joins that corridor instead of searching the whole continent or sea again, the way
 * a settler group shares one (`movement/group-routes.ts`). The command system owns one per pass, so the
 * sharing reaches no further than the orders of one tick.
 */
export class VehicleOrderRoutes {
  private readonly routes: OrderRoute[] = [];

  /** A route for `start` to `goal` joining a route of `group` offered this pass, or null to route alone. */
  borrow(
    terrain: TerrainGraph,
    group: string,
    blocked: BlockOverlay,
    start: NodeId,
    goal: NodeId,
    traversal: Traversal,
  ): NodeId[] | null {
    for (const route of this.routes) {
      const first = route.path[0];
      const last = route.path.at(-1);
      if (route.group !== group || first === undefined || last === undefined) continue;
      if (!near(terrain, start, first) || !near(terrain, goal, last)) continue;
      const joined = joinCorridor(
        terrain,
        route.path,
        start,
        goal,
        blocked,
        { explored: 0 },
        GROUP_AREA_RADIUS_NODES,
        traversal,
      );
      if (joined !== null) return joined;
    }
    return null;
  }

  /** Offer a vehicle's own full route to the rest of its group. */
  offer(group: string, path: readonly NodeId[]): void {
    if (path.length >= SHARED_ROUTE_MIN_NODES) this.routes.push({ group, path });
  }
}

/** Whether `a` lies within the group area (Manhattan half-cell nodes) of `b`. */
function near(terrain: TerrainGraph, a: NodeId, b: NodeId): boolean {
  const distance = Math.abs(terrain.xOf(a) - terrain.xOf(b)) + Math.abs(terrain.yOf(a) - terrain.yOf(b));
  return distance <= GROUP_AREA_RADIUS_NODES;
}
