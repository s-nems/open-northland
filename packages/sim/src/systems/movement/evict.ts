import { Position, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingDoorNodes, dynamicBlockOverlay, walkBlockedBodyOf } from '../footprint/index.js';
import { canonicalById, NodeBuckets } from '../spatial/nodes.js';
import { isTravelling } from './nav-state.js';

/**
 * Move every settler standing inside `building`'s walk-blocked footprint, and every one the stamp just
 * sealed into a one-node nook beside it, onto the nearest free cell. The move is instant because an
 * enclosed cell has no walkable route out: the pathfinder exempts only a blocked start node. Travellers
 * are left alone. Approximation: nook eviction and the missing Owner gate (neutral fixtures and animals
 * are displaced too) have no observed original counterpart.
 */
export function evictSettlersFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to stand on
  const body = walkBlockedBodyOf(world, ctx, terrain, building);
  if (body === null) return; // nothing impassable

  // Travellers enter the occupancy set too, since a landing must not stack on anyone. Sorting is deferred
  // to the evictees so a finish with nobody on or beside the plot early-outs before any sort.
  const units: Entity[] = [];
  const evicteesUnsorted: Entity[] = [];
  const nookCandidates: Entity[] = [];
  for (const e of world.query(Settler, Position)) {
    units.push(e);
    if (isTravelling(world, e)) continue;
    const at = settlerNode(world, terrain, e);
    if (body.has(at)) evicteesUnsorted.push(e);
    else if (terrain.neighbours(at).some((n) => body.has(n))) nookCandidates.push(e);
  }
  if (evicteesUnsorted.length === 0 && nookCandidates.length === 0) return;
  // The membership view, not the owning-set union: every read below is a `.has`.
  const blocked = dynamicBlockOverlay(world, ctx, terrain); // includes this building's own body
  const doors = buildingDoorNodes(world, ctx, terrain);
  // A door is a designated stand rather than a nook, so it is spared here as the blocked set spares it.
  for (const e of nookCandidates) {
    const at = settlerNode(world, terrain, e);
    if (blocked.has(at) || doors.has(at)) continue;
    if (terrain.walkableNeighbours(at).every((n) => blocked.has(n))) evicteesUnsorted.push(e);
  }
  if (evicteesUnsorted.length === 0) return;
  // Canonical order fixes the Position-write and claim order.
  const evictees = canonicalById(evicteesUnsorted);

  // Only `.at(x, y).length` is read, an order-independent count, so the unsorted `units` list is safe
  // here (unlike NodeBuckets.nearest).
  const occupancy = new NodeBuckets(world, units);
  const claimed = new Set<NodeId>();
  for (const e of evictees) {
    const free = nearestFreeCellOutside(
      terrain,
      settlerNode(world, terrain, e),
      body,
      blocked,
      doors,
      occupancy,
      claimed,
    );
    if (free === null) continue; // boxed in - nowhere free to stand; the unit stays
    claimed.add(free);
    const c = terrain.coordsOf(free);
    const centre = positionOfNode(c.x, c.y);
    const pos = world.mut(e, Position);
    pos.x = centre.x;
    pos.y = centre.y;
  }
}

/**
 * Push a settler that spawned on walk-blocked ground off it. Authored maps enqueue every `placeBuilding`
 * before any `spawnSettler`, so humans land inside bodies the footprint eviction already passed over. This
 * crosses other buildings' bodies but never unwalkable terrain, and skips the occupancy check that would
 * cost O(settlers) per spawn; the optional `claimed` set threads one command's batch so a herd fans out
 * instead of stacking. Approximation: whether the original leaves these humans standing on a body is
 * unobserved.
 */
export function evictSettlerFromBlockedSpawn(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  claimed?: Set<NodeId>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to stand on
  const p = world.tryMut(settler, Position);
  if (p === undefined) return;
  const n = nodeOfPosition(p.x, p.y);
  // An off-map spawn stays put: clamping would judge standability from a border node it is not on.
  if (!terrain.inBounds(n.hx, n.hy)) return;
  const from = terrain.nodeAt(n.hx, n.hy);
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const taken = claimed?.has(from) ?? false;
  if (terrain.isWalkable(from) && !blocked.has(from) && !taken) {
    claimed?.add(from); // no push, but a later unit in the batch must still avoid this node
    return;
  }
  const free = nearestUnblockedNode(terrain, from, blocked, claimed);
  if (free === null) return; // boxed in - nowhere free to stand; the settler stays put
  claimed?.add(free);
  const c = terrain.coordsOf(free);
  const centre = positionOfNode(c.x, c.y);
  p.x = centre.x;
  p.y = centre.y;
}

/** The half-cell node a settler stands on, clamped into bounds. */
function settlerNode(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrain.nodeAtClamped(n.hx, n.hy);
}

/**
 * The nearest free node outside every walk-block: the search may cross the evicting building's own `body`
 * but no other blocked cell, and the landing keeps one unblocked orthogonal side so a push never wedges
 * the settler into the next one-node pocket. Null when nothing free is reachable within the cap.
 */
function nearestFreeCellOutside(
  terrain: TerrainGraph,
  from: NodeId,
  body: ReadonlySet<NodeId>,
  blocked: BlockOverlay,
  doors: ReadonlySet<NodeId>,
  occupancy: NodeBuckets,
  claimed: ReadonlySet<NodeId>,
): NodeId | null {
  return ringSearch(terrain, from, STAND_SEARCH_CAP, {
    traverse: (n) => !blocked.has(n) || body.has(n),
    accept: (n) => {
      if (blocked.has(n) || doors.has(n)) return false;
      if (!terrain.walkableNeighbours(n).some((m) => !blocked.has(m))) return false;
      const { x, y } = terrain.coordsOf(n);
      return !claimed.has(n) && occupancy.at(x, y).length === 0;
    },
  });
}
