import type { BlockOverlay } from './block-overlay.js';
import { hexDistanceBetween, hexNeighboursOf } from './halfcell.js';
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
  const area = {
    minX: Math.max(0, hx - range + 1),
    maxX: Math.min(terrain.width - 1, hx + range - 1),
    minY: Math.max(0, hy - range + 1),
    maxY: Math.min(terrain.height - 1, hy + range - 1),
  };
  const width = Math.max(0, area.maxX - area.minX + 1);
  const cells = new Uint8Array(width * Math.max(0, area.maxY - area.minY + 1));
  const result = { ...area, cells };
  if (!terrain.inBounds(hx, hy)) return result;
  const budget = 2 * range;
  const queues: NodeId[][] = Array.from({ length: budget }, () => []);
  const costs = new Map<NodeId, number>();
  const start = terrain.nodeAt(hx, hy);
  if (!terrain.isWalkable(start) || blocked.has(start)) return result;
  queues[0]?.push(start);
  costs.set(start, 0);
  cells[(hy - area.minY) * width + hx - area.minX] = 1;
  for (let cost = 0; cost < budget; cost++) {
    for (const node of queues[cost] ?? []) {
      if (costs.get(node) !== cost) continue;
      for (const next of hexNeighboursOf(terrain.xOf(node), terrain.yOf(node))) {
        if (!terrain.inBounds(next.hx, next.hy)) continue;
        const id = terrain.nodeAt(next.hx, next.hy);
        const resistance = terrain.resistanceAt(id);
        if (!terrain.isWalkable(id) || blocked.has(id) || resistance === 0) continue;
        if (hexDistanceBetween(hx, hy, next.hx, next.hy) < range)
          cells[(next.hy - area.minY) * width + next.hx - area.minX] = 1;
        const nextCost = cost + resistance;
        if (nextCost >= budget || nextCost >= (costs.get(id) ?? budget)) continue;
        costs.set(id, nextCost);
        queues[nextCost]?.push(id);
      }
    }
  }
  return result;
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
  for (const area of areas)
    for (let y = area.minY; y <= area.maxY; y++)
      for (let x = area.minX; x <= area.maxX; x++) {
        if (reachContains(area, x, y)) union.cells[(y - bounds.minY) * width + x - bounds.minX] = 1;
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
