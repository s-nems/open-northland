import { Building, GroundDrop, HarvestedBy, Position, Stockpile, Vehicle } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingDoorNodes, dynamicBlockOverlay, walkBlockedBodyOf } from '../footprint/index.js';
import { canonicalById } from '../spatial/nodes.js';
import { stockpilesAtNode } from '../spatial/stockpiles.js';

/**
 * Push every loose ground pile lying inside `building`'s walk-blocked footprint out onto the nearest free
 * cell. Left buried, a pile stays indexed and geometrically nearest while its stand is unreachable, so
 * every fetcher path-fails against it on a loop. Placement legally lands on piles, so building on a heap of
 * felled wood displaces the wood rather than losing it.
 *
 * A pile is any positioned {@link Stockpile} that is not a persistent store. Each is re-created at its
 * landing node rather than moved in place: the stockpile node index's invariant is that a positioned
 * stockpile never moves, so displacement is destroy plus create, carrying its markers over. A boxed-in pile
 * stays put. Buried piles are visited in canonical ascending-id order and each landed pile occupies its
 * node in the index before the next search runs.
 */
export function evictLooseGoodsFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const body = walkBlockedBodyOf(world, ctx, terrain, building);
  if (body === null) return;

  // Snapshot the buried piles before mutating - the landing loop below creates and destroys entities
  // in the very index this scan reads.
  const buriedUnsorted: Entity[] = [];
  for (const cell of body) {
    const { x, y } = terrain.coordsOf(cell);
    for (const e of stockpilesAtNode(world, x, y)) {
      if (world.has(e, Building) || world.has(e, Vehicle)) continue; // a persistent store keeps its cell
      buriedUnsorted.push(e);
    }
  }
  if (buriedUnsorted.length === 0) return;
  const blocked = dynamicBlockOverlay(world, ctx, terrain); // includes this building's own body
  const doors = buildingDoorNodes(world, ctx, terrain);
  for (const pile of canonicalById(buriedUnsorted)) {
    const pos = world.get(pile, Position);
    const n = nodeOfPosition(pos.x, pos.y);
    const landing = nearestPileLanding(
      world,
      terrain,
      terrain.nodeAtClamped(n.hx, n.hy),
      body,
      blocked,
      doors,
    );
    if (landing === null) continue; // boxed in - the pile stays where it lies
    const c = terrain.coordsOf(landing);
    const at = positionOfNode(c.x, c.y);
    const moved = world.create();
    world.add(moved, Position, { x: at.x, y: at.y });
    world.add(moved, Stockpile, { amounts: world.get(pile, Stockpile).amounts });
    const trunk = world.tryGet(pile, GroundDrop);
    if (trunk !== undefined) world.add(moved, GroundDrop, { goodType: trunk.goodType });
    const harvested = world.tryGet(pile, HarvestedBy);
    if (harvested !== undefined) world.add(moved, HarvestedBy, { by: harvested.by });
    world.destroy(pile);
  }
}

/**
 * The nearest walkable node outside every walk-block where a displaced pile may lie: unblocked and not a
 * door cell. It may traverse the evicting building's own `body`, since the pile is displaced across its
 * plot rather than carried, but never any other blocked cell. Settler occupancy is not tested, as a pile
 * and a settler share a tile freely.
 *
 * A tile with no pile yet is preferred so a different-good heap is never buried under the landing; when the
 * cap runs out before one turns up, the second pass lands on an occupied tile. Two heaps on one tile is a
 * supported state and beats sealing this one inside the new walls.
 */
function nearestPileLanding(
  world: World,
  terrain: TerrainGraph,
  from: NodeId,
  body: ReadonlySet<NodeId>,
  blocked: BlockOverlay,
  doors: ReadonlySet<NodeId>,
): NodeId | null {
  const traverse = (n: NodeId): boolean => !blocked.has(n) || body.has(n);
  const standable = (n: NodeId): boolean => !blocked.has(n) && !doors.has(n);
  const vacant = ringSearch(terrain, from, STAND_SEARCH_CAP, {
    traverse,
    accept: (n) => {
      if (!standable(n)) return false;
      const { x, y } = terrain.coordsOf(n);
      return stockpilesAtNode(world, x, y).length === 0;
    },
  });
  return vacant ?? ringSearch(terrain, from, STAND_SEARCH_CAP, { traverse, accept: standable });
}
