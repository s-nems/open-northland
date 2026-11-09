import { Stockpile } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../spatial/metric.js';
import { stockpilesAtNode } from '../spatial/stockpiles.js';
import { isLoosePile, lowestStockedGood, MAX_GROUND_STACK } from '../stores/index.js';

// A trader whose stop is full sets its goods down by the stop's door. No amount caps the heap; it stops
// only once no ground near the door has room. Carriers, consumers and the seat's stock read it as any other.

/** How far from the door the heap may spread, in rings of nodes: the reach of the search for ground with
 *  room, which bounds its cost. */
export const DOOR_HEAP_RADIUS_NODES = 3;

/** The units of `good` the ground around `door` still takes: the room left in the stacks of every open
 *  tile within {@link DOOR_HEAP_RADIUS_NODES} that holds no other good. */
export function doorHeapRoom(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  door: NodeId,
  good: number,
): number {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  let room = 0;
  forEachDoorTile(terrain, door, (hx, hy) => {
    const node = terrain.nodeAt(hx, hy);
    if (!terrain.isWalkable(node) || blocked.has(node)) return;
    let fill = 0;
    let foreign = false;
    for (const e of stockpilesAtNode(world, hx, hy)) {
      if (!isLoosePile(world, e)) continue;
      const stock = world.get(e, Stockpile);
      const held = lowestStockedGood(stock);
      if (held !== null && held !== good) foreign = true;
      fill += stock.amounts.get(good) ?? 0;
    }
    if (!foreign) room += Math.max(0, MAX_GROUND_STACK - fill);
  });
  return room;
}

/** The units of `good` lying loose within {@link DOOR_HEAP_RADIUS_NODES} of `door`: its heap. */
export function doorHeapUnits(world: World, terrain: TerrainGraph, door: NodeId, good: number): number {
  let units = 0;
  forEachDoorTile(terrain, door, (hx, hy) => {
    for (const e of stockpilesAtNode(world, hx, hy)) {
      if (isLoosePile(world, e)) units += world.get(e, Stockpile).amounts.get(good) ?? 0;
    }
  });
  return units;
}

function forEachDoorTile(terrain: TerrainGraph, door: NodeId, visit: (hx: number, hy: number) => void): void {
  const { x, y } = terrain.coordsOf(door);
  for (let ring = 0; ring <= DOOR_HEAP_RADIUS_NODES; ring++) {
    const offsets = ringOffsetCount(ring);
    for (let i = 0; i < offsets; i++) {
      const hx = x + ringOffsetDx(ring, i);
      const hy = y + ringOffsetDy(ring, i);
      if (terrain.inBounds(hx, hy)) visit(hx, hy);
    }
  }
}
