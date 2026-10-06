import { describe, expect, it } from 'vitest';
import type { BlockOverlay } from '../../src/nav/block-overlay.js';
import { hexDistanceBetween, hexNeighboursOf } from '../../src/nav/halfcell.js';
import { floodReach, searchReach } from '../../src/nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { buildTerrainGraph } from '../../src/nav/terrain/map.js';
import { testContent } from '../fixtures/content.js';

const GRASS = 0;
const WATER = 1;
const MAP_WIDTH = 90;
const MAP_HEIGHT = 70;
/** The `lmpr` values a decoded map carries, 0 included. */
const MAX_ROUGHNESS = 5;
const CASES = 40;

/** The flood rule spelled out with plain maps and neighbour objects: the oracle the scratch-buffer
 *  search must match cell for cell. */
function referenceReach(terrain: TerrainGraph, blocked: BlockOverlay, hx: number, hy: number, range: number) {
  const minX = Math.max(0, hx - range + 1);
  const minY = Math.max(0, hy - range + 1);
  const marked = new Set<string>();
  if (!terrain.inBounds(hx, hy)) return { minX, minY, marked };
  const start = terrain.nodeAt(hx, hy);
  if (!terrain.isWalkable(start) || blocked.has(start)) return { minX, minY, marked };
  const budget = 2 * range;
  const queues: NodeId[][] = Array.from({ length: budget }, () => []);
  const costs = new Map<NodeId, number>([[start, 0]]);
  queues[0]?.push(start);
  marked.add(`${hx}:${hy}`);
  for (let cost = 0; cost < budget; cost++) {
    for (const node of queues[cost] ?? []) {
      if (costs.get(node) !== cost) continue;
      for (const next of hexNeighboursOf(terrain.xOf(node), terrain.yOf(node))) {
        if (!terrain.inBounds(next.hx, next.hy)) continue;
        const id = terrain.nodeAt(next.hx, next.hy);
        const resistance = terrain.resistanceAt(id);
        if (!terrain.isWalkable(id) || blocked.has(id) || resistance === 0) continue;
        if (hexDistanceBetween(hx, hy, next.hx, next.hy) < range) marked.add(`${next.hx}:${next.hy}`);
        const nextCost = cost + resistance;
        if (nextCost >= budget || nextCost >= (costs.get(id) ?? budget)) continue;
        costs.set(id, nextCost);
        queues[nextCost]?.push(id);
      }
    }
  }
  return { minX, minY, marked };
}

/** The Numerical Recipes 32-bit linear congruential constants. */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;

/** A repeatable stream of integers below `bound`. */
function lcg(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state % bound;
  };
}

describe('searchReach', () => {
  it('marks exactly the cells the plain flood rule marks over mixed ground, roads and blockers', () => {
    let spread = 0;
    for (let c = 0; c < CASES; c++) {
      const next = lcg(c + 1);
      const typeIds = Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => (next(8) === 0 ? WATER : GRASS));
      const roughness = Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => next(MAX_ROUGHNESS + 1));
      const terrain = buildTerrainGraph(testContent(), {
        resolution: 'half-cell',
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        typeIds,
        roughness,
      });
      const roads = Array.from({ length: 300 }, () => next(terrain.nodeCount) as NodeId);
      terrain.syncRoads(1, roads);
      const blockedIds = new Set(Array.from({ length: 400 }, () => next(terrain.nodeCount) as NodeId));
      const blocked: BlockOverlay = { size: blockedIds.size, has: (n) => blockedIds.has(n) };
      const hx = next(MAP_WIDTH + 10) - 5;
      const hy = next(MAP_HEIGHT + 10) - 5;
      const range = 1 + next(45);
      const area = searchReach(terrain, blocked, hx, hy, range);
      const expected = referenceReach(terrain, blocked, hx, hy, range);
      const width = area.maxX - area.minX + 1;
      const marked = new Set<string>();
      area.cells.forEach((v, i) => {
        if (v === 1) marked.add(`${area.minX + (i % width)}:${area.minY + Math.floor(i / width)}`);
      });
      expect([area.minX, area.minY]).toEqual([expected.minX, expected.minY]);
      expect([...marked].sort()).toEqual([...expected.marked].sort());
      if (marked.size > range) spread++;
    }
    // Most origins stand on open ground, so the comparison covers real floods, not empty answers.
    expect(spread).toBeGreaterThan(CASES / 2);
  });

  it('answers the same whatever changes outside the box it reports as searched', () => {
    for (let c = 0; c < CASES; c++) {
      const next = lcg(c + 100);
      const roughness = Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => 1 + next(MAX_ROUGHNESS));
      const terrain = buildTerrainGraph(testContent(), {
        resolution: 'half-cell',
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        typeIds: new Array(MAP_WIDTH * MAP_HEIGHT).fill(GRASS),
        roughness,
      });
      const blockedIds = new Set(Array.from({ length: 400 }, () => next(terrain.nodeCount) as NodeId));
      const blocked: BlockOverlay = { size: blockedIds.size, has: (n) => blockedIds.has(n) };
      const hx = next(MAP_WIDTH);
      const hy = next(MAP_HEIGHT);
      const range = 1 + next(30);
      const { area, searched } = floodReach(terrain, blocked, hx, hy, range);
      const outside = (n: NodeId) => {
        const x = terrain.xOf(n);
        const y = terrain.yOf(n);
        return x < searched.minHx || x > searched.maxHx || y < searched.minHy || y > searched.maxHy;
      };
      for (let n = 0 as NodeId; n < terrain.nodeCount; n++) {
        if (!outside(n)) continue;
        if (blockedIds.has(n)) blockedIds.delete(n);
        else blockedIds.add(n);
      }
      terrain.syncRoads(1, Array.from({ length: terrain.nodeCount }, (_, n) => n as NodeId).filter(outside));
      expect(floodReach(terrain, blocked, hx, hy, range).area.cells).toEqual(area.cells);
    }
  });

  it('follows a road laid after the terrain was built', () => {
    const terrain = buildTerrainGraph(testContent(), {
      resolution: 'half-cell',
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      typeIds: new Array(MAP_WIDTH * MAP_HEIGHT).fill(GRASS),
      roughness: new Array(MAP_WIDTH * MAP_HEIGHT).fill(MAX_ROUGHNESS),
    });
    const none: BlockOverlay = { size: 0, has: () => false };
    const far = { hx: 70, hy: 30 };
    const contains = () => {
      const area = searchReach(terrain, none, 40, 30, 40);
      return area.cells[(far.hy - area.minY) * (area.maxX - area.minX + 1) + far.hx - area.minX] === 1;
    };
    expect(contains()).toBe(false);
    terrain.syncRoads(
      1,
      Array.from({ length: 31 }, (_, i) => terrain.nodeAt(40 + i, 30)),
    );
    expect(contains()).toBe(true);
    terrain.syncRoads(2, []);
    expect(contains()).toBe(false);
  });
});
