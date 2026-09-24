import type { BlockOverlay } from '../../nav/block-overlay.js';
import { joinCorridor, type SearchStats } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/**
 * How far (Manhattan half-cell nodes) a group member may start and end from the route it borrows.
 * Authored: wide enough that a hundred men, spread over the player's formation or an AI assault ring,
 * reach one route from its far corner.
 */
const GROUP_AREA_RADIUS_NODES = 48;

/**
 * The shortest route, in nodes, another group member may borrow. Below it a member's own search costs
 * about what the hops on and off the corridor would, so it routes alone. Authored.
 */
const SHARED_ROUTE_MIN_NODES = 96;

interface GroupRoute {
  readonly blocked: BlockOverlay;
  readonly path: readonly NodeId[];
}

/**
 * One tick's group-move routes. A group order is one path request per member, so the lowest-id member
 * routes in full and a member whose start and goal both lie near that route, under the same walk overlay,
 * joins its corridor instead, still in the same tick. A group has no id of its own: sharing the way and
 * the overlay is what makes one.
 */
export class GroupRoutes {
  private readonly routes: GroupRoute[] = [];
  private readonly terrain: TerrainGraph;
  constructor(terrain: TerrainGraph) {
    this.terrain = terrain;
  }

  /** A route borrowing the first shareable route near `start` and `goal`, or null to route alone. */
  borrow(blocked: BlockOverlay, start: NodeId, goal: NodeId, stats: SearchStats): NodeId[] | null {
    for (const route of this.routes) {
      if (route.blocked !== blocked) continue;
      const joined = joinCorridor(
        this.terrain,
        route.path,
        start,
        goal,
        blocked,
        stats,
        GROUP_AREA_RADIUS_NODES,
      );
      if (joined !== null) return joined;
    }
    return null;
  }

  /** Offer a member's own full route to the rest of its group. */
  offer(blocked: BlockOverlay, path: readonly NodeId[]): void {
    if (path.length >= SHARED_ROUTE_MIN_NODES) this.routes.push({ blocked, path });
  }
}
