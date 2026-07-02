import { describe, expect, it } from 'vitest';
import {
  type CellId,
  ONE,
  Simulation,
  TerrainGraph,
  type TerrainMap,
  buildTerrainGraph,
  cellManhattanDistance,
  cellOctileDistance,
  fx,
} from '../../src/index.js';
import { SYSTEM_ORDER, type System, type SystemContext } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

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

/** The diagonal step cost / heuristic weight the graph uses — fixed-point √2 via the sanctioned isqrt. */
const DIAG = fx.isqrt(fx.fromInt(2));

/** An all-grass (fully walkable) map of the given size. */
function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

describe('steps — the pathfinder 8-connected edge set', () => {
  it('emits orthogonal steps (cost ONE) then diagonal steps (cost √2) in canonical order', () => {
    const g = buildTerrainGraph(testContent(), grassMap(3, 3));
    const steps = g.steps(g.cellAt(1, 1)); // centre of an open 3×3: 4 orthogonal + 4 diagonal
    const byCoord = steps.map((s) => ({ ...g.coordsOf(s.cell), cost: s.cost }));
    expect(byCoord).toEqual([
      { x: 1, y: 0, cost: ONE }, // N
      { x: 2, y: 1, cost: ONE }, // E
      { x: 1, y: 2, cost: ONE }, // S
      { x: 0, y: 1, cost: ONE }, // W
      { x: 2, y: 0, cost: DIAG }, // NE
      { x: 2, y: 2, cost: DIAG }, // SE
      { x: 0, y: 2, cost: DIAG }, // SW
      { x: 0, y: 0, cost: DIAG }, // NW
    ]);
  });

  it('omits a diagonal whose shared orthogonal corner is unwalkable (no corner-cut)', () => {
    // 2×2 with water at (1,0). From (0,0): E is water (dropped); the SE diagonal to (1,1) is grass but
    // its corner (1,0) is water, so the diagonal is forbidden — only S survives.
    const g = buildTerrainGraph(testContent(), {
      width: 2,
      height: 2,
      typeIds: [GRASS, WATER, GRASS, GRASS],
    });
    const steps = g.steps(g.cellAt(0, 0)).map((s) => g.coordsOf(s.cell));
    expect(steps).toEqual([{ x: 0, y: 1 }]);
  });

  it('honours the dynamic blocked overlay for the corner cells too', () => {
    const g = buildTerrainGraph(testContent(), grassMap(2, 2));
    const blocked = new Set<CellId>([g.cellAt(1, 0)]); // dynamically block the E cell
    const steps = g.steps(g.cellAt(0, 0), blocked).map((s) => g.coordsOf(s.cell));
    // E blocked; the SE diagonal shares that corner, so it is forbidden too — only S survives.
    expect(steps).toEqual([{ x: 0, y: 1 }]);
  });
});

describe('cellOctileDistance', () => {
  it('is min(dx,dy) diagonals at √2 plus |dx-dy| orthogonals at ONE', () => {
    const g = buildTerrainGraph(testContent(), grassMap(5, 5));
    // (0,0)->(4,3): three diagonal steps + one orthogonal.
    expect(cellOctileDistance(g, g.cellAt(0, 0), g.cellAt(4, 3))).toBe(
      fx.add(fx.fromInt(1), fx.mul(fx.fromInt(3), DIAG)),
    );
    // Pure diagonal: two diagonal steps, no orthogonal remainder.
    expect(cellOctileDistance(g, g.cellAt(0, 0), g.cellAt(2, 2))).toBe(fx.mul(fx.fromInt(2), DIAG));
    expect(cellOctileDistance(g, g.cellAt(0, 0), g.cellAt(0, 0))).toBe(fx.fromInt(0));
  });
});

describe('terrain wired as a world resource on the Simulation', () => {
  it('builds the graph from the map and exposes it on the sim', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: crossMap() });
    expect(sim.terrain).toBeInstanceOf(TerrainGraph);
    expect(sim.terrain?.cellCount).toBe(9);
    expect(sim.terrain?.isWalkable(sim.terrain.cellAt(1, 1))).toBe(false); // centre water
  });

  it('a mapless sim has no terrain resource', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(sim.terrain).toBeUndefined();
  });

  it('surfaces the terrain on the context the real step() schedule receives', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: crossMap() });
    let seen: SystemContext['terrain'];
    const probe: System = (_world, ctx) => {
      seen = ctx.terrain;
    };
    // Splice a probe into the real SYSTEM_ORDER so step() — not a hand-built context — plumbs it.
    const order = SYSTEM_ORDER as System[];
    order.push(probe);
    try {
      sim.step();
    } finally {
      order.pop();
    }
    expect(seen).toBe(sim.terrain);
    expect(seen).toBeInstanceOf(TerrainGraph);
  });

  it('a bad map propagates the builder guard at construction', () => {
    const bad: TerrainMap = { width: 1, height: 1, typeIds: [99] };
    expect(() => new Simulation({ seed: 1, content: testContent(), map: bad })).toThrow(/typeId 99 absent/);
  });

  it('two sims with the same seed + map stay determinism-equal (terrain is not hashed state)', () => {
    const a = new Simulation({ seed: 5, content: testContent(), map: crossMap() });
    const b = new Simulation({ seed: 5, content: testContent(), map: crossMap() });
    a.run(100);
    b.run(100);
    expect(a.hashState()).toBe(b.hashState());
  });
});
