import { footprintCellDx } from '@open-northland/data';
import type { BlockOverlay } from './block-overlay.js';
import { HEX_NEIGHBOUR_OFFSETS, hexDistanceBetween, type NodeArea } from './halfcell.js';
import type { NodeBox, SpatialGate } from './node-circle.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/** A cloneable, bounded piece of the half-cell grid. */
export interface ReachArea extends NodeBox {
  readonly cells: Uint8Array;
}

export function reachContains(area: ReachArea, hx: number, hy: number): boolean {
  if (hx < area.minX || hx > area.maxX || hy < area.minY || hy > area.maxY) return false;
  return area.cells[(hy - area.minY) * (area.maxX - area.minX + 1) + hx - area.minX] === 1;
}

/** Any even and any odd node row: only the parity matters. */
const EVEN_ROW = 0;
const ODD_ROW = 1;
/** Even- and odd-row x offsets and the y offsets of {@link HEX_NEIGHBOUR_OFFSETS}, in its order. */
const HEX_DX_EVEN = HEX_NEIGHBOUR_OFFSETS.map((c) => footprintCellDx(EVEN_ROW, c));
const HEX_DX_ODD = HEX_NEIGHBOUR_OFFSETS.map((c) => footprintCellDx(ODD_ROW, c));
const HEX_DY = HEX_NEIGHBOUR_OFFSETS.map((c) => c.dy);

/** Per-call scratch shared by every flood and fully reset before use, so it carries no state: the
 *  best cost per node of the flood's window, and the bucket queue as one linked list of entries per
 *  cost (the first entry per cost, then each entry's node and successor). Typed lists, because an
 *  array per cost ran up to twice as slow depending on the order the engine warmed the code in. */
let costScratch = new Uint16Array(0);
let headScratch = new Int32Array(0);
let entryNodes = new Int32Array(0);
let entryNext = new Int32Array(0);
const NO_ENTRY = -1;

/** Doubles the entry lists, keeping the entries written so far. */
function growEntries(): void {
  const size = Math.max(1024, 2 * entryNodes.length);
  const nodes = new Int32Array(size);
  nodes.set(entryNodes);
  entryNodes = nodes;
  const next = new Int32Array(size);
  next.set(entryNext);
  entryNext = next;
}

/** {@link searchReach}'s answer with the box of every node the flood inspected, the only nodes whose
 *  ground, blockers and roads the answer depends on. */
export interface ReachSearch {
  readonly area: ReachArea;
  readonly searched: NodeArea;
}

/** Original range searches walk six neighbours, spend twice the nominal range in ground resistance,
 *  and inspect an entered node before charging its resistance. Guide callbacks also require distance
 *  strictly below the nominal range. Byte-verified behavior; the navigation grid and blockers are ours. */
export function searchReach(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  hx: number,
  hy: number,
  range: number,
): ReachArea {
  return floodReach(terrain, blocked, hx, hy, range).area;
}

/** {@link searchReach} with its searched box. The marked set is order-independent: a node is marked when
 *  it neighbours any node whose cheapest cost stays under the budget, so the order a bucket is walked in
 *  does not matter. */
export function floodReach(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  hx: number,
  hy: number,
  range: number,
): ReachSearch {
  const minX = Math.max(0, hx - range + 1);
  const maxX = Math.min(terrain.width - 1, hx + range - 1);
  const minY = Math.max(0, hy - range + 1);
  const maxY = Math.min(terrain.height - 1, hy + range - 1);
  const width = Math.max(0, maxX - minX + 1);
  const cells = new Uint8Array(width * Math.max(0, maxY - minY + 1));
  const area = { minX, maxX, minY, maxY, cells };
  const unmoved = { area, searched: { minHx: hx, maxHx: hx, minHy: hy, maxHy: hy } };
  if (!terrain.inBounds(hx, hy)) return unmoved;
  const start = terrain.nodeAt(hx, hy);
  if (!terrain.isWalkable(start) || blocked.has(start)) return unmoved;
  cells[(hy - minY) * width + hx - minX] = 1;
  const budget = 2 * range;
  // Every entered node costs at least one, so a node with a cost under the budget lies fewer than
  // `budget` hex steps from the start, each moving at most one node on either axis.
  const reach = budget - 1;
  const side = 2 * reach + 1;
  const windowX = hx - reach;
  const windowY = hy - reach;
  if (costScratch.length < side * side) costScratch = new Uint16Array(side * side);
  const costs = costScratch;
  costs.fill(budget, 0, side * side);
  if (headScratch.length < budget) headScratch = new Int32Array(budget);
  const heads = headScratch;
  heads.fill(NO_ENTRY, 0, budget);
  let entries = 0;
  const resistances = terrain.walkableResistances();
  const mapWidth = terrain.width;
  const mapHeight = terrain.height;
  let poppedMinX = hx;
  let poppedMaxX = hx;
  let poppedMinY = hy;
  let poppedMaxY = hy;
  costs[reach * side + reach] = 0;
  if (entryNodes.length === 0) growEntries();
  entryNodes[0] = start;
  entryNext[0] = NO_ENTRY;
  heads[0] = entries++;
  for (let cost = 0; cost < budget; cost++) {
    // Every push lands in a later bucket, so this one stays fixed while it is walked.
    for (let entry = heads[cost] as number; entry !== NO_ENTRY; entry = entryNext[entry] as number) {
      const node = entryNodes[entry] as number;
      const x = node % mapWidth;
      const y = (node - x) / mapWidth;
      if (costs[(y - windowY) * side + x - windowX] !== cost) continue;
      if (x < poppedMinX) poppedMinX = x;
      if (x > poppedMaxX) poppedMaxX = x;
      if (y < poppedMinY) poppedMinY = y;
      if (y > poppedMaxY) poppedMaxY = y;
      const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
      for (let k = 0; k < HEX_DY.length; k++) {
        const nx = x + (dxs[k] as number);
        const ny = y + (HEX_DY[k] as number);
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) continue;
        const id = ny * mapWidth + nx;
        const resistance = resistances[id] as number;
        if (resistance === 0 || blocked.has(id as NodeId)) continue;
        if (hexDistanceBetween(hx, hy, nx, ny) < range) cells[(ny - minY) * width + nx - minX] = 1;
        const nextCost = cost + resistance;
        if (nextCost >= budget) continue;
        const slot = (ny - windowY) * side + nx - windowX;
        if (nextCost >= (costs[slot] as number)) continue;
        costs[slot] = nextCost;
        if (entries === entryNodes.length) growEntries();
        entryNodes[entries] = id;
        entryNext[entries] = heads[nextCost] as number;
        heads[nextCost] = entries++;
      }
    }
  }
  // A popped node inspects its neighbours, one node out on either axis.
  const searched = {
    minHx: Math.max(0, poppedMinX - 1),
    maxHx: Math.min(mapWidth - 1, poppedMaxX + 1),
    minHy: Math.max(0, poppedMinY - 1),
    maxHy: Math.min(mapHeight - 1, poppedMaxY + 1),
  };
  return { area, searched };
}

export function unionReachAreas(areas: readonly ReachArea[]): ReachArea {
  if (areas.length === 1 && areas[0] !== undefined) return areas[0];
  if (areas.length === 0) return { minX: 0, maxX: -1, minY: 0, maxY: -1, cells: new Uint8Array() };
  const bounds = {
    minX: Math.min(...areas.map((a) => a.minX)),
    maxX: Math.max(...areas.map((a) => a.maxX)),
    minY: Math.min(...areas.map((a) => a.minY)),
    maxY: Math.max(...areas.map((a) => a.maxY)),
  };
  const width = bounds.maxX - bounds.minX + 1;
  const union: ReachArea = { ...bounds, cells: new Uint8Array(width * (bounds.maxY - bounds.minY + 1)) };
  for (const area of areas) {
    const areaWidth = area.maxX - area.minX + 1;
    for (let y = area.minY; y <= area.maxY; y++) {
      const from = (y - area.minY) * areaWidth;
      const to = (y - bounds.minY) * width + area.minX - bounds.minX;
      for (let x = 0; x < areaWidth; x++) if (area.cells[from + x] === 1) union.cells[to + x] = 1;
    }
  }
  return union;
}

export function reachGate(terrain: TerrainGraph, areas: readonly ReachArea[]): SpatialGate {
  const union = unionReachAreas(areas);
  return { bounds: union, allowsNode: (node) => reachContains(union, terrain.xOf(node), terrain.yOf(node)) };
}

export function intersectReach(a: SpatialGate | undefined, b: SpatialGate | null): SpatialGate | undefined {
  if (b === null) return a;
  if (a === undefined) return b;
  return { bounds: b.bounds, allowsNode: (node) => a.allowsNode(node) && b.allowsNode(node) };
}
