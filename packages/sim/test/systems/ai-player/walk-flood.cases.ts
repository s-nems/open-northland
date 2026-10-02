import { describe, expect, it } from 'vitest';
import { fx } from '../../../src/core/fixed.js';
import { Simulation } from '../../../src/index.js';
import type { BlockOverlay } from '../../../src/nav/block-overlay.js';
import { CountedBlocks } from '../../../src/nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../../../src/nav/world-metric.js';
import {
  budgetCertainBelow,
  COST_PAGE_SIZE,
  SeedWalks,
  WalkFlood,
  walkLowerBound,
} from '../../../src/systems/ai-player/walk-distance.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap, waterColumnMap } from '../../fixtures/terrain.js';

// The lazy walk flood behind the flag spot search: the same costs whatever is asked first, and a budget
// that cuts the far side off.

const MAP_CELLS_WIDE = 24;
const MAP_CELLS_HIGH = 12;
/** The cell column of water that splits the map into two banks. */
const WATER_COLUMN = 12;
const SEED = { hx: 4, hy: 4 };
/** Nodes on the seed's bank, near and far, and one across the water. */
const WEST_NEAR = { hx: 6, hy: 6 };
const WEST_FAR = { hx: 20, hy: 18 };
const EAST = { hx: 40, hy: 10 };
/** A flood budget past the bank's node count, so only the water stops it. */
const WHOLE_BANK = 100_000;
/** A budget that settles a few nodes round the seed and no more. */
const SMALL_BUDGET = 12;

function bank(): TerrainGraph {
  const sim = new Simulation({
    seed: 1,
    content: aiContent(),
    map: waterColumnMap(MAP_CELLS_WIDE, MAP_CELLS_HIGH, WATER_COLUMN),
  });
  if (sim.terrain === undefined) throw new Error('setup: no terrain');
  return sim.terrain;
}

const NO_BLOCKS = new CountedBlocks([]);

function flood(terrain: TerrainGraph, seed: { hx: number; hy: number }, budget = WHOLE_BANK): WalkFlood {
  return new WalkFlood(terrain, NO_BLOCKS, [terrain.nodeAt(seed.hx, seed.hy)], budget);
}

describe('ai-player walk flood', () => {
  it('costs a node the same whether it is asked first, last or alone', () => {
    const terrain = bank();
    const nodes: NodeId[] = [];
    for (let hy = 0; hy < 2 * MAP_CELLS_HIGH; hy += 3) {
      for (let hx = 0; hx < 2 * MAP_CELLS_WIDE; hx += 5) nodes.push(terrain.nodeAt(hx, hy));
    }
    const forward = flood(terrain, SEED);
    const forwardCosts = nodes.map((node) => forward.costTo(node));
    const backward = flood(terrain, SEED);
    const backwardCosts = [...nodes]
      .reverse()
      .map((node) => backward.costTo(node))
      .reverse();
    const aloneCosts = nodes.map((node) => flood(terrain, SEED).costTo(node));
    expect(backwardCosts).toEqual(forwardCosts);
    expect(aloneCosts).toEqual(forwardCosts);
    expect(forwardCosts.some((cost) => cost !== undefined)).toBe(true);
  });

  it('reaches the seed bank and never the far one', () => {
    const terrain = bank();
    const walk = flood(terrain, SEED);
    expect(walk.costTo(terrain.nodeAt(SEED.hx, SEED.hy))).toBe(fx.fromInt(0));
    const near = walk.costTo(terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy));
    const far = walk.costTo(terrain.nodeAt(WEST_FAR.hx, WEST_FAR.hy));
    if (near === undefined || far === undefined) throw new Error('the seed bank is walkable');
    expect(near).toBeLessThan(far);
    expect(walk.costTo(terrain.nodeAt(EAST.hx, EAST.hy))).toBeUndefined();
  });

  it('keeps exact costs across a page boundary in either query order and honors the settle budget', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(48, 12) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    // These adjacent horizontal nodes straddle a page boundary.
    const nodes = [30, 31, 32, 33].map((hx) => terrain.nodeAt(hx, 2));
    const seed = nodes[0];
    if (seed === undefined) throw new Error('seed expected');
    expect(nodes).toEqual([COST_PAGE_SIZE - 2, COST_PAGE_SIZE - 1, COST_PAGE_SIZE, COST_PAGE_SIZE + 1]);
    const expected = [0, 0.5, 1, 1.5].map((cost) => fx.fromFloat(cost));
    const forward = new WalkFlood(terrain, NO_BLOCKS, [seed], WHOLE_BANK);
    const backward = new WalkFlood(terrain, NO_BLOCKS, [seed], WHOLE_BANK);
    expect(nodes.map((node) => forward.costTo(node))).toEqual(expected);
    expect(
      [...nodes]
        .reverse()
        .map((node) => backward.costTo(node))
        .reverse(),
    ).toEqual(expected);
    const limited = new WalkFlood(terrain, NO_BLOCKS, [seed], 1);
    expect(limited.costTo(terrain.nodeAt(32, 2))).toBeUndefined();
    expect(limited.costTo(seed)).toBe(fx.fromInt(0));
  });

  it('floors a cost without flooding: never above the cost, exact once settled, none once spent', () => {
    const terrain = bank();
    const walk = flood(terrain, SEED);
    const near = terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy);
    const far = terrain.nodeAt(WEST_FAR.hx, WEST_FAR.hy);
    const nearCost = walk.costTo(near);
    const floor = walk.costFloor(far);
    const farCost = flood(terrain, SEED).costTo(far);
    if (nearCost === undefined || floor === undefined || farCost === undefined)
      throw new Error('bank walkable');
    expect(floor).toBeLessThanOrEqual(farCost);
    expect(floor).toBeGreaterThanOrEqual(fx.fromInt(0));
    expect(walk.costFloor(near)).toBe(nearCost);
    walk.costTo(terrain.nodeAt(EAST.hx, EAST.hy)); // floods the whole bank
    expect(walk.costFloor(terrain.nodeAt(EAST.hx, EAST.hy))).toBeUndefined();
    const spent = flood(terrain, SEED, SMALL_BUDGET);
    spent.costTo(far);
    expect(spent.costFloor(far)).toBeUndefined();
  });

  it('reads a node past the budget as unreached, the settled ones as before', () => {
    const terrain = bank();
    const walk = flood(terrain, SEED, SMALL_BUDGET);
    const near = walk.costTo(terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy));
    expect(walk.costTo(terrain.nodeAt(WEST_FAR.hx, WEST_FAR.hy))).toBeUndefined();
    expect(walk.costTo(terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy))).toBe(near);
    expect(
      near === undefined || near === flood(terrain, SEED).costTo(terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy)),
    ).toBe(true);
  });

  it('bounds no step above its cost', () => {
    const steps: [number, number, number][] = [
      [1, 0, HALF_COLUMN],
      [0, 1, HALF_ROW],
      [1, 2, DIAGONAL_STEP],
    ];
    for (const [dx, dy, cost] of steps) {
      for (const [sx, sy] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        expect(walkLowerBound(sx * dx, sy * dy)).toBeLessThanOrEqual(cost);
      }
    }
  });

  it('certifies only costs a flood of that budget settles on open ground', () => {
    const terrain = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(80, 80) }).terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const seed = terrain.nodeAt(40, 40);
    const certain = budgetCertainBelow(SMALL_BUDGET);
    const walk = new WalkFlood(terrain, NO_BLOCKS, [seed], SMALL_BUDGET);
    const whole = new WalkFlood(terrain, NO_BLOCKS, [seed], WHOLE_BANK);
    for (let hy = 30; hy <= 50; hy++) {
      for (let hx = 34; hx <= 46; hx++) {
        const node = terrain.nodeAt(hx, hy);
        const cost = whole.costTo(node);
        if (cost !== undefined && cost < certain) expect(walk.costTo(node)).toBe(cost);
      }
    }
  });

  it('answers every query exactly as the lazy flood of its budget, round walls and past the budget', () => {
    const { terrain, blocked, seed } = walledMap();
    for (const budget of WALLED_BUDGETS) {
      for (const toward of WALLED_TARGETS) {
        const reference = new WalkFlood(terrain, blocked, [seed], budget);
        const walk = new SeedWalks(terrain, blocked, seed, budget, 'flood').toward(toward, WALLED_REACH);
        forEachNear(terrain, toward, (node) => {
          const floor = walk.costFloor(node);
          const cost = walk.costTo(node);
          expect(cost).toBe(reference.costTo(node));
          if (floor !== undefined && cost !== undefined) expect(floor).toBeLessThanOrEqual(cost);
          if (floor === undefined) expect(cost).toBeUndefined();
        });
      }
    }
  });

  it('answers aimed walks with their true cost, a node past the settle cap unreached', () => {
    const { terrain, blocked, seed } = walledMap();
    const whole = new WalkFlood(terrain, blocked, [seed], WHOLE_BANK);
    let pastFloodBudget = 0;
    for (const budget of WALLED_BUDGETS) {
      for (const toward of WALLED_TARGETS) {
        const flood = new WalkFlood(terrain, blocked, [seed], budget);
        const walk = new SeedWalks(terrain, blocked, seed, budget, 'aimed').toward(toward, WALLED_REACH);
        forEachNear(terrain, toward, (node) => {
          const floor = walk.costFloor(node);
          const cost = walk.costTo(node);
          if (cost !== undefined) expect(cost).toBe(whole.costTo(node));
          if (budget === WHOLE_BANK) expect(cost).toBe(whole.costTo(node));
          if (cost !== undefined && flood.costTo(node) === undefined) pastFloodBudget++;
          if (floor !== undefined && cost !== undefined) expect(floor).toBeLessThanOrEqual(cost);
          if (floor === undefined) expect(cost).toBeUndefined();
        });
      }
    }
    // The aimed corridor reaches nodes the flood of the same budget never settles.
    expect(pastFloodBudget).toBeGreaterThan(0);
  });
});

const WALLED_MAP_NODES = 64;
const WALLED_TARGETS = [
  { hx: 12, hy: 10 },
  { hx: 60, hy: 50 },
  { hx: 33, hy: 34 },
  { hx: 2, hy: 62 },
];
const WALLED_BUDGETS = [SMALL_BUDGET, 400, WHOLE_BANK];
const WALLED_REACH = 6;

/** Open ground broken by walls of blocked nodes: every fifth column below a gap, every seventh row beside
 *  one, and a seed clear in the middle. */
function walledMap(): { terrain: TerrainGraph; blocked: BlockOverlay; seed: NodeId } {
  const sim = new Simulation({
    seed: 1,
    content: aiContent(),
    map: grassNodeMap(WALLED_MAP_NODES, WALLED_MAP_NODES),
  });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  const walls = new Set<NodeId>();
  for (let hy = 0; hy < WALLED_MAP_NODES; hy++) {
    for (let hx = 0; hx < WALLED_MAP_NODES; hx++) {
      if (!terrain.inBounds(hx, hy)) continue;
      const column = hx % 5 === 0 && hy % 13 > 3;
      const row = hy % 7 === 0 && hx % 11 > 2;
      if (column || row) walls.add(terrain.nodeAt(hx, hy));
    }
  }
  const blocked: BlockOverlay = { has: (node) => walls.has(node), size: walls.size };
  const seed = terrain.nodeAt(WALLED_MAP_NODES / 2, WALLED_MAP_NODES / 2);
  if (walls.has(seed)) throw new Error('setup: the seed stands clear');
  return { terrain, blocked, seed };
}

/** Each in-bounds node within two rings past {@link WALLED_REACH} of `toward`, innermost ring first. */
function forEachNear(
  terrain: TerrainGraph,
  toward: { hx: number; hy: number },
  visit: (node: NodeId) => void,
) {
  for (let r = 0; r <= WALLED_REACH + 2; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const dy of [r - Math.abs(dx), Math.abs(dx) - r]) {
        const x = toward.hx + dx;
        const y = toward.hy + dy;
        if (terrain.inBounds(x, y)) visit(terrain.nodeAt(x, y));
      }
    }
  }
}
