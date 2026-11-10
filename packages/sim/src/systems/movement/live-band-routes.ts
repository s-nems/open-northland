import type { ContentSet } from '@open-northland/data';
import { Owner, PathFollow, PathRoute, PlayerOrder } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { columnStepMiddles, isColumnStep, nodeMarksOf } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { hasBodyCollision } from './collision/index.js';

/**
 * Live routes offered at once to a walker ordered after its band left. Authored: a band walks a few
 * corridors, and each one offered costs every later member a stamp per node.
 */
const MAX_LIVE_BAND_ROUTES = 8;

/** The shortest stretch of a live route worth taking up, in nodes. Authored. */
const LIVE_ROUTE_MIN_NODES = 16;

/**
 * The routes still ahead of the player-ordered walkers of `player` of one order kind and body rule, so
 * under the same walk blocks, each as lattice nodes from the stop its walker heads for, lowest entity id
 * first. A walker heading for a node of a route already taken walks
 * that corridor and adds none, and a route with a node `blocked` now closes is left out. Read off saved
 * components alone, so a restored world offers the same routes.
 */
export function liveBandRoutes(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
  marching: boolean,
  collides: boolean,
  blocked: BlockOverlay,
): NodeId[][] {
  const routes: NodeId[][] = [];
  const marks = nodeMarksOf(terrain);
  const taken = marks.next();
  for (const e of world.canonicalQuery(PlayerOrder)) {
    if (routes.length >= MAX_LIVE_BAND_ROUTES) break;
    if (world.tryGet(e, Owner)?.player !== player) continue;
    if ((world.get(e, PlayerOrder).attackMove !== undefined) !== marching) continue;
    const stops = world.tryGet(e, PathRoute)?.waypoints;
    const next = world.tryGet(e, PathFollow)?.index;
    if (stops === undefined || next === undefined) continue;
    const heading = stops[next];
    if (heading === undefined || marks.stamps[heading.node] === taken) continue;
    if (hasBodyCollision(world, content, e) !== collides) continue;
    const path = latticePath(terrain, stops, next, blocked);
    if (path === null || path.length < LIVE_ROUTE_MIN_NODES) continue;
    for (const node of path) marks.stamps[node] = taken;
    routes.push(path);
  }
  return routes;
}

/**
 * The nodes of `stops[from..]` as a walk over lattice edges: a column step gets back the node it skips,
 * whichever of the two beside it is open and joined, and a stop repeating its node is dropped. Null when
 * a node is closed by `blocked` or two stops are joined by no edge.
 */
function latticePath(
  terrain: TerrainGraph,
  stops: readonly { readonly node: NodeId }[],
  from: number,
  blocked: BlockOverlay,
): NodeId[] | null {
  const path: NodeId[] = [];
  for (let i = from; i < stops.length; i++) {
    const node = stops[i]?.node;
    const previous = path.at(-1);
    if (node === undefined || node === previous) continue;
    if (blocked.has(node)) return null;
    if (previous !== undefined && !terrain.joined(previous, node)) {
      if (!isColumnStep(terrain, previous, node)) return null;
      const middle = columnStepMiddles(terrain, previous, node).find(
        (between) =>
          between !== undefined &&
          terrain.isWalkable(between) &&
          !blocked.has(between) &&
          terrain.joined(previous, between) &&
          terrain.joined(between, node),
      );
      if (middle === undefined) return null;
      path.push(middle);
    }
    path.push(node);
  }
  return path;
}
