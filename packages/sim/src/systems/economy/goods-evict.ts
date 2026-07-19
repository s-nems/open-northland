import { Building, GroundDrop, HarvestedBy, Position, Stockpile, Vehicle } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import { buildingDoorNodes, dynamicBlockOverlay } from '../footprint/index.js';
import { canonicalById } from '../spatial.js';
import { stockpilesAtNode } from '../stockpile-index.js';

/** Max nodes one pile's landing search visits before leaving it in place — the same boxed-in stance
 *  (and cap value) as the settler eviction's FOOTPRINT_EVICT_SEARCH_CAP. */
const GOODS_EVICT_SEARCH_CAP = 192;

/**
 * Push every loose ground pile lying inside `building`'s walk-blocked footprint out onto the nearest
 * free cell — the goods sibling of `evictSettlersFromFootprint`, run when a plot becomes impassable (a
 * `placeBuilding` onto a heaped yard, a construction/upgrade finish whose larger tier encloses new
 * cells). Without it a felled-trunk or dropped-goods pile stays walled in: still indexed, still the
 * geometrically nearest source, but its stand is unreachable — every fetcher path-fails against it on
 * a loop. Placement legally lands on piles (the ground-collision gate ignores them), so building on a
 * heap of felled wood is safe: the wood is displaced, never lost.
 *
 * A pile is any positioned {@link Stockpile} that is not a persistent store (a {@link Building}
 * warehouse or {@link Vehicle} hull keeps its cells) — a {@link GroundDrop} trunk and a bare yard heap
 * both move. Each is re-created at its landing node rather than moved in place: the stockpile node
 * index's invariant is that a positioned stockpile never moves, so displacement is destroy + create
 * (markers carried over — a gatherer still reclaims its own trunk). A boxed-in pile stays put, like a
 * boxed-in settler.
 *
 * Determinism: buried piles are visited in canonical ascending-id order, the landing search expands
 * the graph's canonical neighbour order, and each landed pile occupies its node in the stockpile index
 * before the next search runs — no store-order pick anywhere.
 */
export function evictLooseGoodsFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to lie on
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const footprint = buildingFootprintOf(ctx.content, b.buildingType);
  if (footprint === undefined || footprint.blocked.length === 0) return; // nothing impassable
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const body = new Set<NodeId>(translatedCells(terrain, footprint.blocked, ax, ay));
  const door = footprint.door;
  if (door !== undefined && terrain.inBounds(ax + door.dx, ay + door.dy)) {
    body.delete(terrain.nodeAt(ax + door.dx, ay + door.dy)); // the door stays a reachable stand
  }
  if (body.size === 0) return;

  // Snapshot the buried piles before mutating — the landing loop below creates and destroys entities
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
    if (landing === null) continue; // boxed in — nowhere free to lie; the pile stays (goods kept)
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
 * The nearest walkable node outside every walk-block where a displaced pile may lie: unblocked, not a
 * door cell (a designated stand), and holding no positioned stockpile yet — one pile per tile, so a
 * different-good heap is never buried under the landing. A breadth-first ring search from `from` in
 * the graph's canonical neighbour order that MAY traverse the evicting building's own `body` (the pile
 * is displaced across its plot, not carried) but never any other blocked cell — the same shape as the
 * settler eviction's `nearestFreeCellOutside`, minus its settler-occupancy rules (a pile and a settler
 * share a tile freely). Null when nothing free lies within the cap.
 */
function nearestPileLanding(
  world: World,
  terrain: TerrainGraph,
  from: NodeId,
  body: ReadonlySet<NodeId>,
  blocked: BlockOverlay,
  doors: ReadonlySet<NodeId>,
): NodeId | null {
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  let visited = 0;
  while (frontier.length > 0 && visited < GOODS_EVICT_SEARCH_CAP) {
    const next: NodeId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n)) continue;
        if (blocked.has(n) && !body.has(n)) continue; // another building/resource — neither target nor path
        seen.add(n);
        visited++;
        if (!blocked.has(n) && !doors.has(n)) {
          const { x, y } = terrain.coordsOf(n);
          if (stockpilesAtNode(world, x, y).length === 0) return n;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
