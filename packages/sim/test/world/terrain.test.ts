import { describe, expect, it } from 'vitest';
import {
  type CellId,
  DIAGONAL_STEP,
  HALF_COLUMN,
  HALF_ROW,
  ONE,
  Simulation,
  TerrainGraph,
  type TerrainMap,
  buildTerrainGraph,
  cellLatticeDistance,
  fx,
  halfCellMapFromCells,
} from '../../src/index.js';
import { SYSTEM_ORDER, type System, type SystemContext } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit tests for the terrain HALF-CELL ADJACENCY GRAPH (the sim's navigation model). The fixture's
 * landscape table has typeId 0 = grass (walkable) and 1 = water (not walkable); these tests pin the
 * deterministic addressing, neighbour order, the half-cell upsampling, and the 8-direction edge set
 * the pathfinder depends on.
 */

const GRASS = 0;
const WATER = 1;

/** A 3×3-CELL map with a water cell in the centre and grass elsewhere, upsampled to its 6×6 nodes. */
function crossMap(): TerrainMap {
  return halfCellMapFromCells({
    width: 3,
    height: 3,
    typeIds: [GRASS, GRASS, GRASS, GRASS, WATER, GRASS, GRASS, GRASS, GRASS],
  });
}

/** A raw half-cell grid, all grass except the listed water nodes — for node-granular fixtures the
 *  2×2-block upsampler cannot express. */
function rawGrid(
  width: number,
  height: number,
  water: ReadonlyArray<readonly [number, number]> = [],
): TerrainMap {
  const typeIds = new Array(width * height).fill(GRASS);
  for (const [x, y] of water) typeIds[y * width + x] = WATER;
  return { resolution: 'half-cell', width, height, typeIds };
}

describe('halfCellMapFromCells', () => {
  it('stamps each cell onto its 2×2 half-cell block (the original lane convention)', () => {
    const m = halfCellMapFromCells({ width: 2, height: 1, typeIds: [GRASS, WATER] });
    expect(m.width).toBe(4);
    expect(m.height).toBe(2);
    // Cell (1,0) owns nodes (2..3, 0..1); cell (0,0) owns (0..1, 0..1).
    expect(m.typeIds).toEqual([GRASS, GRASS, WATER, WATER, GRASS, GRASS, WATER, WATER]);
  });

  it('rejects a cell grid whose length disagrees with its dimensions', () => {
    expect(() => halfCellMapFromCells({ width: 2, height: 2, typeIds: [GRASS] })).toThrow(/expected 4/);
  });
});

describe('buildTerrainGraph', () => {
  it('builds the doubled grid from the content landscape table', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(g.width).toBe(6);
    expect(g.height).toBe(6);
    expect(g.cellCount).toBe(36);
  });

  it('rejects a map whose grid length disagrees with its dimensions', () => {
    const bad: TerrainMap = { resolution: 'half-cell', width: 2, height: 2, typeIds: [GRASS, GRASS, GRASS] };
    expect(() => buildTerrainGraph(testContent(), bad)).toThrow(/expected 4/);
  });

  it('rejects a map referencing a landscape typeId absent from content', () => {
    const bad: TerrainMap = { resolution: 'half-cell', width: 1, height: 1, typeIds: [99] };
    expect(() => buildTerrainGraph(testContent(), bad)).toThrow(/typeId 99 absent/);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => new TerrainGraph(0, 1, new Int32Array(0), new Map())).toThrow(/dimensions must be positive/);
  });
});

describe('cell addressing is row-major and invertible', () => {
  it('cellAt / coordsOf round-trip for every node', () => {
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
    expect(() => g.cellAt(6, 0)).toThrow(/out of bounds/);
    expect(g.inBounds(6, 0)).toBe(false);
    expect(g.inBounds(5, 5)).toBe(true);
  });
});

describe('walkability + per-type props resolve from the IR', () => {
  it('grass is walkable, the water cell blocks all four of its nodes', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(g.isWalkable(g.cellAt(0, 0))).toBe(true);
    // The centre CELL (1,1) owns nodes (2..3, 2..3) — all four are water.
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ] as const) {
      expect(g.isWalkable(g.cellAt(x, y))).toBe(false);
      expect(g.typeAt(g.cellAt(x, y))).toBe(WATER);
    }
  });

  it('walk cost is fixed-point ONE for a walkable node', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(g.walkCost(g.cellAt(0, 0))).toBe(ONE);
  });
});

describe('neighbours are emitted in canonical N, E, S, W order', () => {
  it('an interior node yields exactly its four in-bounds neighbours in order', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(3, 3));
    const ns = g.neighbours(g.cellAt(1, 1)).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 1, y: 0 }, // N
      { x: 2, y: 1 }, // E
      { x: 1, y: 2 }, // S
      { x: 0, y: 1 }, // W
    ]);
  });

  it('a corner node yields only its in-bounds neighbours, still in canonical order', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(3, 3));
    const ns = g.neighbours(g.cellAt(0, 0)).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 1, y: 0 }, // E
      { x: 0, y: 1 }, // S
    ]);
  });

  it('walkableNeighbours drops a water node', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(3, 3, [[1, 1]]));
    // From (1,0): N is off-map, E (2,0) grass, S (1,1) WATER dropped, W (0,0) grass.
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

describe('steps — the pathfinder half-cell lattice edge set', () => {
  it('emits the eight edges in canonical order with their world-length costs (parity-independent)', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(5, 5));
    const steps = g.steps(g.cellAt(2, 2)).map((s) => ({ ...g.coordsOf(s.cell), cost: s.cost }));
    expect(steps).toEqual([
      { x: 3, y: 2, cost: HALF_COLUMN }, // E — one half-column (34 px)
      { x: 1, y: 2, cost: HALF_COLUMN }, // W
      { x: 3, y: 0, cost: DIAGONAL_STEP }, // NE — the 51 px lattice edge
      { x: 3, y: 4, cost: DIAGONAL_STEP }, // SE
      { x: 1, y: 4, cost: DIAGONAL_STEP }, // SW
      { x: 1, y: 0, cost: DIAGONAL_STEP }, // NW
      { x: 2, y: 1, cost: HALF_ROW }, // N — one half-row (19 px)
      { x: 2, y: 3, cost: HALF_ROW }, // S
    ]);
  });

  it('emits the same offsets from an odd row — the half-cell lattice has no parity', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(5, 7));
    const even = g.steps(g.cellAt(2, 2)).map((s) => {
      const c = g.coordsOf(s.cell);
      return { dx: c.x - 2, dy: c.y - 2, cost: s.cost };
    });
    const odd = g.steps(g.cellAt(2, 3)).map((s) => {
      const c = g.coordsOf(s.cell);
      return { dx: c.x - 2, dy: c.y - 3, cost: s.cost };
    });
    expect(odd).toEqual(even);
  });

  it('drops a diagonal when BOTH midpoint flank nodes are unwalkable (a wall seam is not a gap)', () => {
    // From (1,1), SE lands on (2,3); the edge midpoint sits between (1,2) and (2,2). Both water:
    // the seam is a wall joint — the destination itself stays grass, so only the flank rule drops it.
    const g = buildTerrainGraph(
      testContent(),
      rawGrid(4, 5, [
        [1, 2],
        [2, 2],
      ]),
    );
    const se = g
      .steps(g.cellAt(1, 1))
      .map((s) => g.coordsOf(s.cell))
      .filter((c) => c.x === 2 && c.y === 3);
    expect(se).toEqual([]);
  });

  it('keeps a diagonal when ONE flank node is walkable (sliding the seam past a blocked flank)', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(4, 5, [[1, 2]]));
    const se = g
      .steps(g.cellAt(1, 1))
      .map((s) => g.coordsOf(s.cell))
      .filter((c) => c.x === 2 && c.y === 3);
    expect(se).toEqual([{ x: 2, y: 3 }]);
  });

  it('gates the diagonal flanks on the dynamic blocked overlay too', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(4, 5));
    const blocked = new Set<CellId>([g.cellAt(1, 2), g.cellAt(2, 2)]); // both flanks of (1,1)→(2,3)
    const se = g
      .steps(g.cellAt(1, 1), blocked)
      .map((s) => g.coordsOf(s.cell))
      .filter((c) => c.x === 2 && c.y === 3);
    expect(se).toEqual([]);
  });

  it('omits an unwalkable destination (walkability gates the DESTINATION node)', () => {
    // From (0,0) on a 2×2 node grid with water E: E dropped, S survives; everything else off-map.
    // E/W and N/S connect directly adjacent nodes, so only the destination's walkability gates them.
    const g = buildTerrainGraph(testContent(), rawGrid(2, 2, [[1, 0]]));
    const steps = g.steps(g.cellAt(0, 0)).map((s) => g.coordsOf(s.cell));
    expect(steps).toEqual([{ x: 0, y: 1 }]);
  });

  it('honours the dynamic blocked overlay', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(2, 2));
    const blocked = new Set<CellId>([g.cellAt(1, 0)]); // dynamically block the E node
    const steps = g.steps(g.cellAt(0, 0), blocked).map((s) => g.coordsOf(s.cell));
    // E blocked; S (0,1) survives — the SE diagonal (1,2) is off-map.
    expect(steps).toEqual([{ x: 0, y: 1 }]);
  });
});

describe('cellLatticeDistance', () => {
  it('prices a sideways-dominant offset with all rows crossed diagonally plus half-column steps', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    // (0,0)->(5,3): ax=5, ay=3 → ⌊3/2⌋=1 diagonal + 4 half-columns + the odd leftover half-row.
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(5, 3))).toBe(
      fx.add(fx.add(DIAGONAL_STEP, fx.mul(fx.fromInt(4), HALF_COLUMN)), HALF_ROW),
    );
    // Pure E: (0,0)->(4,0) = four half-columns = two full columns.
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(4, 0))).toBe(fx.fromInt(2));
    // The diagonal edge itself: (0,0)->(1,2).
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(1, 2))).toBe(DIAGONAL_STEP);
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(0, 0))).toBe(fx.fromInt(0));
  });

  it('prices a vertical-dominant offset with straight half-row steps, diagonals only for the offset', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    // Straight down the screen, (2,0)->(2,4): four half-row steps, no weave premium.
    expect(cellLatticeDistance(g, g.cellAt(2, 0), g.cellAt(2, 4))).toBe(fx.mul(fx.fromInt(4), HALF_ROW));
    // (0,0)->(1,4): 2·ax=2 ≤ ay=4 — one diagonal absorbs the column, two half-rows remain.
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(1, 4))).toBe(
      fx.add(DIAGONAL_STEP, fx.mul(fx.fromInt(2), HALF_ROW)),
    );
    // (0,0)->(0,3): three straight half-rows.
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(0, 3))).toBe(fx.mul(fx.fromInt(3), HALF_ROW));
  });
});

describe('terrain wired as a world resource on the Simulation', () => {
  it('builds the graph from the map and exposes it on the sim', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: crossMap() });
    expect(sim.terrain).toBeInstanceOf(TerrainGraph);
    expect(sim.terrain?.cellCount).toBe(36);
    expect(sim.terrain?.isWalkable(sim.terrain.cellAt(2, 2))).toBe(false); // centre water block
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
    const bad: TerrainMap = { resolution: 'half-cell', width: 1, height: 1, typeIds: [99] };
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
