import { describe, expect, it } from 'vitest';
import {
  type CellId,
  DIAGONAL_STEP,
  ONE,
  Simulation,
  TerrainGraph,
  type TerrainMap,
  VERTICAL_STEP,
  buildTerrainGraph,
  cellLatticeDistance,
  cellManhattanDistance,
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

/** An all-grass (fully walkable) map of the given size. */
function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

describe('steps — the pathfinder staggered-lattice edge set', () => {
  it('emits the six lattice edges from an ODD row: E/W (cost ONE) then NE,SE,SW,NW (cost ¾)', () => {
    const g = buildTerrainGraph(testContent(), grassMap(3, 3));
    const steps = g.steps(g.cellAt(1, 1)); // centre of an open 3×3, row 1 = odd (half-shifted right)
    const byCoord = steps.map((s) => ({ ...g.coordsOf(s.cell), cost: s.cost }));
    expect(byCoord).toEqual([
      { x: 2, y: 1, cost: ONE }, // E
      { x: 0, y: 1, cost: ONE }, // W
      { x: 2, y: 0, cost: DIAGONAL_STEP }, // NE — odd row: +col up
      { x: 2, y: 2, cost: DIAGONAL_STEP }, // SE — odd row: +col down
      { x: 1, y: 2, cost: DIAGONAL_STEP }, // SW — odd row: same col down
      { x: 1, y: 0, cost: DIAGONAL_STEP }, // NW — odd row: same col up
    ]);
  });

  it('emits the parity-mirrored offsets from an EVEN row (same screen headings)', () => {
    const g = buildTerrainGraph(testContent(), grassMap(3, 3));
    const steps = g.steps(g.cellAt(1, 2)); // row 2 = even (unshifted)
    const byCoord = steps.map((s) => g.coordsOf(s.cell));
    expect(byCoord).toEqual([
      { x: 2, y: 2 }, // E
      { x: 0, y: 2 }, // W
      { x: 1, y: 1 }, // NE — even row: same col up (the odd row above is shifted right)
      { x: 0, y: 1 }, // NW — even row: -col up
      { x: 1, y: 0 }, // N — straight up two rows, same column (S is off-map)
    ]);
  });

  it('emits the vertical N/S steps (two rows, same column) at the VERTICAL_STEP cost', () => {
    const g = buildTerrainGraph(testContent(), grassMap(3, 5));
    const steps = g.steps(g.cellAt(1, 2)); // row 2 = even; rows 0 and 4 are both in bounds
    const verticals = steps.filter((s) => Math.abs(g.coordsOf(s.cell).y - 2) === 2);
    expect(verticals.map((s) => ({ ...g.coordsOf(s.cell), cost: s.cost }))).toEqual([
      { x: 1, y: 0, cost: VERTICAL_STEP }, // N first (the THexagonDirection tail order)
      { x: 1, y: 4, cost: VERTICAL_STEP }, // S
    ]);
  });

  it('drops a vertical step when BOTH intermediate flank cells are unwalkable (a wall seam is not a gap)', () => {
    // 3×5, all grass except row 3 fully water — going S from (1,2) the seam between (0,3)/(1,3)
    // is a wall joint; the target row 4 itself is grass, so only the flank rule can drop the step.
    const typeIds = new Array(15).fill(GRASS);
    for (let x = 0; x < 3; x++) typeIds[3 * 3 + x] = WATER;
    const g = buildTerrainGraph(testContent(), { width: 3, height: 5, typeIds });
    const south = g
      .steps(g.cellAt(1, 2))
      .map((s) => g.coordsOf(s.cell))
      .filter((c) => c.y === 4);
    expect(south).toEqual([]);
  });

  it('keeps a vertical step when ONE flank cell is walkable (sliding the seam past a blocked flank)', () => {
    // Same map but only the SW flank (0,3) is water — the SE flank (1,3) keeps the gap open.
    const typeIds = new Array(15).fill(GRASS);
    typeIds[3 * 3 + 0] = WATER;
    const g = buildTerrainGraph(testContent(), { width: 3, height: 5, typeIds });
    const south = g
      .steps(g.cellAt(1, 2))
      .map((s) => g.coordsOf(s.cell))
      .filter((c) => c.y === 4);
    expect(south).toEqual([{ x: 1, y: 4 }]);
  });

  it('gates the vertical flanks on the dynamic blocked overlay too', () => {
    const g = buildTerrainGraph(testContent(), grassMap(3, 5));
    const blocked = new Set<CellId>([g.cellAt(0, 3), g.cellAt(1, 3)]); // both S flanks of (1,2)
    const south = g
      .steps(g.cellAt(1, 2), blocked)
      .map((s) => g.coordsOf(s.cell))
      .filter((c) => c.y === 4);
    expect(south).toEqual([]);
  });

  it('omits an unwalkable destination (walkability gates the DESTINATION cell)', () => {
    // 2×2 with water at (1,0). From (0,0) (even row): E is water (dropped), SE = (0,1) survives;
    // SW/NE/NW are off-map. The lattice has no corner-cut rule — its row-crossing edges cross a full
    // shared diamond edge, so only the destination's own walkability gates a step.
    const g = buildTerrainGraph(testContent(), {
      width: 2,
      height: 2,
      typeIds: [GRASS, WATER, GRASS, GRASS],
    });
    const steps = g.steps(g.cellAt(0, 0)).map((s) => g.coordsOf(s.cell));
    expect(steps).toEqual([{ x: 0, y: 1 }]);
  });

  it('honours the dynamic blocked overlay', () => {
    const g = buildTerrainGraph(testContent(), grassMap(2, 2));
    const blocked = new Set<CellId>([g.cellAt(1, 0)]); // dynamically block the E cell
    const steps = g.steps(g.cellAt(0, 0), blocked).map((s) => g.coordsOf(s.cell));
    // E blocked; only the SE lattice edge to (0,1) survives (the rest are off-map).
    expect(steps).toEqual([{ x: 0, y: 1 }]);
  });
});

describe('cellLatticeDistance', () => {
  it('prices a sideways-dominant offset as all-diagonal row-crossings plus E/W column steps', () => {
    const g = buildTerrainGraph(testContent(), grassMap(5, 5));
    // (0,0)->(4,3): world-x offset 4.5 (4 columns + the odd-row half shift); 3 row-crossings absorb
    // 1.5 of it, leaving 3 full column steps.
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(4, 3))).toBe(
      fx.add(fx.fromInt(3), fx.mul(fx.fromInt(3), DIAGONAL_STEP)),
    );
    // (0,0)->(2,2): world-x offset 2; 2 row-crossings absorb 1, leaving 1 column step.
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(2, 2))).toBe(
      fx.add(fx.fromInt(1), fx.mul(fx.fromInt(2), DIAGONAL_STEP)),
    );
    // (0,0)->(0,1): the SE lattice edge itself — one row-crossing, half-column shift fully absorbed.
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(0, 1))).toBe(DIAGONAL_STEP);
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(0, 0))).toBe(fx.fromInt(0));
  });

  it('prices a vertical-dominant offset with straight N/S steps, diagonals only for the offset', () => {
    const g = buildTerrainGraph(testContent(), grassMap(5, 7));
    // Straight down the screen, (2,0)->(2,4): two straight vertical steps, no weave premium.
    expect(cellLatticeDistance(g, g.cellAt(2, 0), g.cellAt(2, 4))).toBe(fx.mul(fx.fromInt(2), VERTICAL_STEP));
    // (0,0)->(0,3): half a column of offset (the odd-row shift) — one diagonal absorbs it, the
    // remaining two rows are one vertical step.
    expect(cellLatticeDistance(g, g.cellAt(0, 0), g.cellAt(0, 3))).toBe(fx.add(VERTICAL_STEP, DIAGONAL_STEP));
    // (1,0)->(0,6): one column left over six rows (whx=2 < rows=6): two diagonals + two verticals.
    expect(cellLatticeDistance(g, g.cellAt(1, 0), g.cellAt(0, 6))).toBe(
      fx.add(fx.mul(fx.fromInt(2), VERTICAL_STEP), fx.mul(fx.fromInt(2), DIAGONAL_STEP)),
    );
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
