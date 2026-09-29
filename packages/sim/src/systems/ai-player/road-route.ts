import { footprintCellDx } from '@open-northland/data';
import { HEX_NEIGHBOUR_OFFSETS, hexDistanceBetween } from '../../nav/halfcell.js';
import { type IndexedHeapRecord, siftDown, siftUp } from '../../nav/pathfinding/heap.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { HALF_COLUMN, HALF_ROW } from '../../nav/world-metric.js';

/**
 * What entering a node costs a road route, or null where the route may not pass. The AI weighs a node
 * already paved or pending cheapest, open ground a road site may take next, and walkable ground no site
 * may take (a signpost, a house's upgrade room) dearest, so a route crosses that only where no pavable
 * way exists.
 */
export type RoadStepCost = (node: NodeId) => number | null;

interface OpenRecord extends IndexedHeapRecord {
  readonly node: NodeId;
  g: number;
  f: number;
}

const better = (a: OpenRecord, b: OpenRecord): boolean => a.f < b.f || (a.f === b.f && a.node < b.node);

// A node's step across and down the screen, as raw fixed-point integers: the lattice has no stagger there.
const NODE_SCREEN_X: number = HALF_COLUMN;
const NODE_SCREEN_Y: number = HALF_ROW;

/**
 * A road route from `from` to `to` over the six-node ring a road paints across (`hexNeighboursOf`), so
 * each step joins two nodes one road triangle spans and the laid road has no gap. The walkers' eight steps
 * include a two-row diagonal that a road would leave unpaved between its ends.
 *
 * A* under the hex distance at `leastStepCost` per step, a lower bound, so the route is a cheapest one
 * and a road one row aside is taken rather than paralleled. Among the predecessors that keep the found
 * cost, the walk back takes the one nearest the straight line through the ends, as the road tool's drawn
 * line does, so an open stretch runs straight rather than as a staircase. Null when `to` is unreachable
 * within `maxExplored` settled nodes.
 */
export function roadRoute(
  terrain: TerrainGraph,
  from: NodeId,
  to: NodeId,
  stepCost: RoadStepCost,
  leastStepCost: number,
  maxExplored: number,
): NodeId[] | null {
  const goalX = terrain.xOf(to);
  const goalY = terrain.yOf(to);
  const heuristic = (x: number, y: number): number => hexDistanceBetween(x, y, goalX, goalY) * leastStepCost;
  const records = new Map<NodeId, OpenRecord>();
  const closed = new Set<NodeId>();
  const heap: OpenRecord[] = [];
  const start: OpenRecord = {
    node: from,
    g: 0,
    f: heuristic(terrain.xOf(from), terrain.yOf(from)),
    heapIdx: 0,
  };
  records.set(from, start);
  heap.push(start);
  while (heap.length > 0 && closed.size < maxExplored) {
    const current = heap[0];
    const last = heap.pop();
    if (current === undefined || last === undefined) break;
    if (heap.length > 0) {
      heap[0] = last;
      siftDown(heap, 0, better);
    }
    closed.add(current.node);
    if (current.node === to) return walkBack(terrain, from, to, records, closed, stepCost);
    const x = terrain.xOf(current.node);
    const y = terrain.yOf(current.node);
    for (const offset of HEX_NEIGHBOUR_OFFSETS) {
      const nx = x + footprintCellDx(y, offset);
      const ny = y + offset.dy;
      if (!terrain.inBounds(nx, ny)) continue;
      const next = terrain.nodeAt(nx, ny);
      if (closed.has(next)) continue;
      const cost = stepCost(next);
      if (cost === null) continue;
      const g = current.g + cost;
      const held = records.get(next);
      if (held === undefined) {
        const record: OpenRecord = { node: next, g, f: g + heuristic(nx, ny), heapIdx: heap.length };
        records.set(next, record);
        heap.push(record);
        siftUp(heap, record.heapIdx, better);
      } else if (g < held.g) {
        held.f += g - held.g;
        held.g = g;
        siftUp(heap, held.heapIdx, better);
      }
    }
  }
  return null;
}

/** The route from `from` to `to` through settled nodes whose costs chain exactly, each step back taking
 *  the predecessor nearest the straight line through `from` and `to`, the lower node id on a tie. */
function walkBack(
  terrain: TerrainGraph,
  from: NodeId,
  to: NodeId,
  records: ReadonlyMap<NodeId, OpenRecord>,
  closed: ReadonlySet<NodeId>,
  stepCost: RoadStepCost,
): NodeId[] {
  const ax = terrain.xOf(from) * NODE_SCREEN_X;
  const ay = terrain.yOf(from) * NODE_SCREEN_Y;
  const vx = terrain.xOf(to) * NODE_SCREEN_X - ax;
  const vy = terrain.yOf(to) * NODE_SCREEN_Y - ay;
  // The distance from the line through the ends, times the segment's length.
  const offLine = (x: number, y: number): number =>
    Math.abs((x * NODE_SCREEN_X - ax) * vy - (y * NODE_SCREEN_Y - ay) * vx);
  const route: NodeId[] = [to];
  let node = to;
  while (node !== from) {
    const g = records.get(node)?.g ?? 0;
    const entered = g - (stepCost(node) ?? 0);
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    let best: NodeId | null = null;
    let bestOff = Number.POSITIVE_INFINITY;
    for (const offset of HEX_NEIGHBOUR_OFFSETS) {
      const px = x + footprintCellDx(y, offset);
      const py = y + offset.dy;
      if (!terrain.inBounds(px, py)) continue;
      const prev = terrain.nodeAt(px, py);
      if (!closed.has(prev) || records.get(prev)?.g !== entered) continue;
      const off = offLine(px, py);
      if (off < bestOff || (off === bestOff && best !== null && prev < best)) {
        best = prev;
        bestOff = off;
      }
    }
    // A settled node's cost was set by a settled predecessor, so one always chains.
    if (best === null) return route.reverse();
    route.push(best);
    node = best;
  }
  return route.reverse();
}
