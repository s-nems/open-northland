import { Building, Owner, Position, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import { canonicalById, isTravelling, NodeBuckets } from '../spatial.js';

/** Max nodes the displacement ring search visits before giving up — a plot boxed in on a pathological
 *  map leaves its occupants in place rather than searching the whole world (same cap stance as the
 *  spacing drives' SPACING_SEARCH_CAP). */
const EVICT_SEARCH_CAP = 192;

/**
 * Push every settler standing inside `building`'s walk-blocked footprint out onto the nearest free
 * cell — the moment a plot becomes (or grows) impassable: a `placeBuilding` onto occupied ground, a
 * construction finish (a stray that wandered onto the plot mid-build), and a home tier upgrade whose
 * larger footprint encloses new cells. Displacement is an instant Position move, not a walk order: an
 * enclosed interior cell has no walkable route out (the pathfinder exempts only the START node, never
 * a blocked mid-route cell), so a walk could never leave a multi-cell body. The building's door cell
 * is spared — it is the passable gate, exactly as `buildingBlockedCells` carves it out.
 *
 * Only standing units move: a walker mid-transit passes through freely (transit is never blocked) and
 * its own route plays out. Owner-gated like the spacing drives (`deStackIdle`), so unowned scenario
 * fixtures stay byte-identical. Determinism: evictees are visited in canonical ascending-id order, the
 * ring search expands the graph's canonical neighbour order, and each claimed target is excluded from
 * later searches — no store-order pick anywhere.
 */
export function evictSettlersFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to stand on
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const footprint = buildingFootprintOf(ctx.content, b.buildingType);
  if (footprint === undefined || footprint.blocked.length === 0) return; // nothing impassable
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const body = new Set<NodeId>(translatedCells(terrain, footprint.blocked, ax, ay));
  const door = footprint.door;
  if (door !== undefined && terrain.inBounds(ax + door.dx, ay + door.dy)) {
    body.delete(terrain.nodeAt(ax + door.dx, ay + door.dy)); // the door stays a passable stand
  }
  if (body.size === 0) return;

  // One unsorted pass: every non-travelling owned settler (for the occupancy check) and, of those, the
  // ones standing on the body (the evictees). The sort is deferred to the evictees alone — the common
  // case (a finish with no stray on the plot) early-outs here before any sort, NodeBuckets, or overlay
  // build, so a tick of many simultaneous finishes doesn't pay a full settler sort per building.
  const standing: Entity[] = [];
  const evicteesUnsorted: Entity[] = [];
  for (const e of world.query(Settler, Position, Owner)) {
    if (isTravelling(world, e)) continue;
    standing.push(e);
    if (body.has(settlerNode(world, terrain, e))) evicteesUnsorted.push(e);
  }
  if (evicteesUnsorted.length === 0) return;
  // Only the evictees need canonical order — it fixes the deterministic Position-write + claim order.
  const evictees = canonicalById(evicteesUnsorted);

  // Occupancy is read only for `.at(x,y).length` (is a cell already stood on?), a membership count
  // independent of input order — so the unsorted `standing` list is fine here (unlike NodeBuckets.nearest).
  const occupancy = new NodeBuckets(world, standing);
  const blocked = dynamicBlockedCells(world, ctx, terrain); // includes this building's own body
  const claimed = new Set<NodeId>();
  for (const e of evictees) {
    const free = nearestFreeCellOutside(
      terrain,
      settlerNode(world, terrain, e),
      body,
      blocked,
      occupancy,
      claimed,
    );
    if (free === null) continue; // boxed in — nowhere free to stand; the unit stays
    claimed.add(free);
    const c = terrain.coordsOf(free);
    const centre = positionOfNode(c.x, c.y);
    const pos = world.get(e, Position);
    pos.x = centre.x;
    pos.y = centre.y;
  }
}

/** The half-cell node a settler stands on (its Position snapped to the lattice). */
function settlerNode(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrain.nodeAtClamped(n.hx, n.hy);
}

/**
 * The nearest walkable node outside every walk-block that no standing settler occupies and no earlier
 * evictee has claimed — a breadth-first ring search from `from` in the graph's canonical neighbour
 * order (first hit at minimum ring distance, history-independent). Unlike the spacing drives' search
 * it MAY traverse the evicting building's own `body` cells (the evictee is displaced across its plot,
 * not walked), but never any other blocked cell. Null when nothing free is reachable within the cap.
 */
function nearestFreeCellOutside(
  terrain: TerrainGraph,
  from: NodeId,
  body: ReadonlySet<NodeId>,
  blocked: ReadonlySet<NodeId>,
  occupancy: NodeBuckets,
  claimed: ReadonlySet<NodeId>,
): NodeId | null {
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  let visited = 0;
  while (frontier.length > 0 && visited < EVICT_SEARCH_CAP) {
    const next: NodeId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n)) continue;
        if (blocked.has(n) && !body.has(n)) continue; // another building/resource — neither target nor path
        seen.add(n);
        visited++;
        if (!blocked.has(n)) {
          const { x, y } = terrain.coordsOf(n);
          if (!claimed.has(n) && occupancy.at(x, y).length === 0) return n;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
