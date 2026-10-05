import { MoveGoal, PathFollow, PathRequest, PathRoute, Position } from '../../../components/index.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { positionOfNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { routeStartCell } from '../../movement/route-start.js';
import { settlerTraversal } from '../../movement/traversal.js';
import { isValidNodeId } from '../../spatial/nodes.js';

const byId = (e: Entity): number => e;

/** Whether a planner visit to `e` would act: it holds a goal, no pending request, and no route that
 *  already ends on the goal. Every visit acts, by issuing a request or dropping the goal. */
function needsVisit(world: World, e: Entity): boolean {
  if (!world.isAlive(e) || !world.has(e, Position)) return false;
  const goal = world.tryGet(e, MoveGoal);
  if (goal === undefined || world.has(e, PathRequest)) return false;
  if (!world.has(e, PathFollow)) return true;
  const stops = world.get(e, PathRoute).waypoints;
  // A route ends on the centre of its last path node, which that waypoint carries.
  return stops[stops.length - 1]?.node !== goal.cell;
}

/** The goal holders {@link needsVisit} names, in ascending id, kept from a change feed so the planner
 *  passes by walkers whose goal, request and route stayed put. */
class UnsettledWalkers {
  private readonly unsettled: Entity[] = [];
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(private readonly world: World) {
    this.feed = world.watchChanges(
      [Position, MoveGoal, PathRequest, PathFollow, PathRoute],
      [MoveGoal, PathRoute],
    );
    this.rebuild();
  }

  /** The list to visit, caught up. Held live: the pass's own writes only reach it at the next catch-up. */
  current(): readonly Entity[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    return this.unsettled;
  }

  private refresh(e: Entity): void {
    const wanted = needsVisit(this.world, e);
    if (wanted === includesSortedId(this.unsettled, e, byId)) return;
    if (wanted) insertSortedById(this.unsettled, e, byId);
    else removeSortedById(this.unsettled, e, byId);
  }

  private rebuild(): void {
    this.unsettled.length = 0;
    for (const e of this.world.canonicalQuery(Position, MoveGoal)) {
      if (needsVisit(this.world, e)) this.unsettled.push(e);
    }
  }

  verify(): string[] {
    const held = this.current();
    const fresh = this.world.canonicalQuery(Position, MoveGoal).filter((e) => needsVisit(this.world, e));
    const same = held.length === fresh.length && held.every((e, i) => fresh[i] === e);
    return same ? [] : ['navigationPlanner unsettled walkers diverge from a fresh scan'];
  }
}

const walkersByWorld = new WeakMap<World, UnsettledWalkers>();

function unsettledWalkersOf(world: World): readonly Entity[] {
  let held = walkersByWorld.get(world);
  if (held === undefined) {
    const created = new UnsettledWalkers(world);
    world.registerCacheVerifier('unsettledWalkers', () => created.verify());
    walkersByWorld.set(world, created);
    held = created;
  }
  return held.current();
}

/**
 * Turn a {@link MoveGoal} on a request-less entity into a {@link PathRequest} from the entity's nearest
 * cell to the goal cell, and remove a goal the entity already stands on. An entity walking a route that
 * ends at the goal plays it out; a route ending anywhere else is stale and is re-routed from where the
 * walker stands, so the splice replaces the path in the same tick and carries its momentum through the
 * turn. A goal whose request just failed is left in place and not re-issued: the failed flag is the
 * signal the owning drive reads. Walkers are visited in ascending id.
 */
export function navigationPlanner(world: World, terrain: TerrainGraph): void {
  for (const e of unsettledWalkersOf(world)) {
    const goalNode = world.get(e, MoveGoal).cell;
    if (!isValidNodeId(terrain, goalNode)) {
      // An off-map goal can never be satisfied, so drop it rather than issue dead requests every tick.
      world.remove(e, MoveGoal);
      continue;
    }

    const p = world.get(e, Position);
    // A walker with a route here is on one that ends elsewhere, so the goal changed mid-walk: re-route.
    if (!world.has(e, PathFollow)) {
      const g = terrain.coordsOf(goalNode); // validated just above
      const centre = positionOfNode(g.x, g.y);
      if (p.x === centre.x && p.y === centre.y) {
        world.remove(e, MoveGoal); // standing exactly on the goal node: satisfied
        continue;
      }
    }

    // Routing from the nearest walkable bracket cell rather than the truncated one keeps a spliced
    // first leg short and forward, since truncation binds a walker to the centre behind it.
    world.add(e, PathRequest, {
      start: routeStartCell(terrain, p.x, p.y, settlerTraversal(world, e)),
      goal: goalNode,
      failed: false,
    });
  }
}
