import { describe, expect, it } from 'vitest';
import {
  type CellId,
  ONE,
  TerrainGraph,
  type TerrainMap,
  buildTerrainGraph,
  cellManhattanDistance,
  fx,
} from '../src/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Unit tests for the terrain CELL-ADJACENCY GRAPH (the sim's navigation model). The fixture's
 * landscape table has typeId 0 = grass (walkable) and 1 = water (not walkable); these tests pin the
 * deterministic addressing, neighbour order, and walkability resolution the pathfinder depends on.
 */

const GRASS = 0;
const WATER = 1;

/** A 3×3 map with a water cell in the centre (1) and grass elsewhere (0). */
function crossMap(): TerrainMap {
  return {
    width: 3,
    height: 3,
    typeIds: [GRASS, GRASS, GRASS, GRASS, WATER, GRASS, GRASS, GRASS, GRASS],
  };
}

describe('buildTerrainGraph', () => {
  it('builds a grid of the right size from the content landscape table', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(g.width).toBe(3);
    expect(g.height).toBe(3);
    expect(g.cellCount).toBe(9);
  });

  it('rejects a map whose grid length disagrees with its dimensions', () => {
    const bad: TerrainMap = { width: 2, height: 2, typeIds: [GRASS, GRASS, GRASS] };
    expect(() => buildTerrainGraph(testContent(), bad)).toThrow(/expected 4/);
  });

  it('rejects a map referencing a landscape typeId absent from content', () => {
    const bad: TerrainMap = { width: 1, height: 1, typeIds: [99] };
    expect(() => buildTerrainGraph(testContent(), bad)).toThrow(/typeId 99 absent/);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => new TerrainGraph(0, 1, new Int32Array(0), new Map())).toThrow(/dimensions must be positive/);
  });
});

describe('cell addressing is row-major and invertible', () => {
  it('cellAt / coordsOf round-trip for every cell', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const cell = g.cellAt(x, y);
        expect(cell).toBe((y * g.width + x) as CellId);
        expect(g.coordsOf(cell)).toEqual({ x, y });
      }
    }
  });

  it('throws on an out-of-bounds lookup (programmer error)', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(() => g.cellAt(3, 0)).toThrow(/out of bounds/);
    expect(g.inBounds(3, 0)).toBe(false);
    expect(g.inBounds(2, 2)).toBe(true);
  });
});

describe('walkability + per-type props resolve from the IR', () => {
  it('grass is walkable, water is not', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(g.isWalkable(g.cellAt(0, 0))).toBe(true);
    expect(g.isWalkable(g.cellAt(1, 1))).toBe(false); // centre water
    expect(g.typeAt(g.cellAt(1, 1))).toBe(WATER);
  });

  it('walk cost is fixed-point ONE for a walkable cell', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(g.walkCost(g.cellAt(0, 0))).toBe(ONE);
  });
});

describe('neighbours are emitted in canonical N, E, S, W order', () => {
  it('a centre cell yields exactly its four in-bounds neighbours in order', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    const centre = g.cellAt(1, 1);
    const ns = g.neighbours(centre).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 1, y: 0 }, // N
      { x: 2, y: 1 }, // E
      { x: 1, y: 2 }, // S
      { x: 0, y: 1 }, // W
    ]);
  });

  it('a corner cell yields only its in-bounds neighbours, still in canonical order', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    const ns = g.neighbours(g.cellAt(0, 0)).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 1, y: 0 }, // E
      { x: 0, y: 1 }, // S
    ]);
  });

  it('walkableNeighbours drops the centre water cell from a grass neighbour', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    // The top-middle grass cell (1,0): neighbours are E(2,0) grass, S(1,1) WATER, W(0,0) grass.
    const ns = g.walkableNeighbours(g.cellAt(1, 0)).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 2, y: 0 }, // E grass
      { x: 0, y: 0 }, // W grass — S is water, dropped
    ]);
  });

  it('produces byte-identical neighbour lists across rebuilds (determinism)', () => {
    const a = buildTerrainGraph(testContent(), crossMap());
    const b = buildTerrainGraph(testContent(), crossMap());
    for (let i = 0; i < a.cellCount; i++) {
      const cell = i as CellId;
      expect(a.neighbours(cell)).toEqual(b.neighbours(cell));
      expect(a.walkableNeighbours(cell)).toEqual(b.walkableNeighbours(cell));
    }
  });
});

describe('cellManhattanDistance', () => {
  it('is the fixed-point grid step distance', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    const a = g.cellAt(0, 0);
    const b = g.cellAt(2, 2);
    expect(cellManhattanDistance(g, a, b)).toBe(fx.fromInt(4));
    expect(cellManhattanDistance(g, a, a)).toBe(fx.fromInt(0));
  });
});
