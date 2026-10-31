import { describe, expect, it } from 'vitest';
import { fx } from '../../../../src/core/fixed.js';
import { Simulation } from '../../../../src/index.js';
import type { BlockOverlay } from '../../../../src/nav/block-overlay.js';
import { CountedBlocks, NodeMask } from '../../../../src/nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../../src/nav/terrain/index.js';
import {
  budgetCertainBelow,
  SeedWalks,
  WalkFlood,
  walkLowerBound,
} from '../../../../src/systems/computer-player/walk-distance.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { stepDijkstra } from '../../../fixtures/step-dijkstra.js';
import { grassNodeMap, waterColumnMap } from '../../../fixtures/terrain.js';

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

describe('computer-player walk flood', () => {
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

  it('answers a capped ask with the cost within the cap, none past it, and floods no further than the cap', () => {
    const terrain = bank();
    const far = terrain.nodeAt(WEST_FAR.hx, WEST_FAR.hy);
    const farCost = flood(terrain, SEED).costTo(far);
    if (farCost === undefined) throw new Error('bank walkable');
    const capped = flood(terrain, SEED);
    expect(capped.costWithin(far, fx.sub(farCost, fx.fromInt(1)))).toBeUndefined();
    // Stopped under the cap, the flood still floors the node there and settles it on the next ask.
    expect(capped.costFloor(far)).toBeGreaterThanOrEqual(fx.sub(farCost, fx.fromInt(1)));
    expect(capped.costWithin(far, farCost)).toBe(farCost);
    expect(capped.costWithin(terrain.nodeAt(EAST.hx, EAST.hy), farCost)).toBeUndefined();
  });

  it('bounds no step above its cost, from an even and an odd row', () => {
    const terrain = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(8, 8) }).terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    for (const from of [terrain.nodeAt(6, 6), terrain.nodeAt(6, 7)]) {
      const fromX = terrain.xOf(from);
      const fromY = terrain.yOf(from);
      for (const step of terrain.steps(from)) {
        const bound = walkLowerBound(fromX, fromY, terrain.xOf(step.node), terrain.yOf(step.node));
        expect(bound).toBeLessThanOrEqual(step.cost);
      }
    }
  });

  it.each([
    ['even', 40],
    ['odd', 41],
  ])(
    'certifies only costs a flood of that budget settles on open ground, seeded on an %s row',
    (_parity, seedY) => {
      const terrain = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(80, 80) }).terrain;
      if (terrain === undefined) throw new Error('mapped sim expected');
      const seed = terrain.nodeAt(40, seedY);
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
    },
  );

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

  it('answers over a byte mask exactly as a reference flood and as the same blocks behind any overlay', () => {
    let state = RANDOM_SEED;
    const draw = (bound: number): number => {
      state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
      return state % bound;
    };
    // Water strewn over the grass, so diagonals meet unwalkable flanks as well as blocked ones.
    const typeIds = Array.from({ length: WALLED_MAP_NODES * WALLED_MAP_NODES }, () =>
      draw(PERCENT) < RANDOM_WATER_PERCENT ? WATER_TYPE : GRASS_TYPE,
    );
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { resolution: 'half-cell', width: WALLED_MAP_NODES, height: WALLED_MAP_NODES, typeIds },
    });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    for (let trial = 0; trial < RANDOM_TRIALS; trial++) {
      const mask = new NodeMask(terrain.nodeCount);
      for (let node = 0; node < terrain.nodeCount; node++) {
        if (draw(PERCENT) < RANDOM_BLOCKED_PERCENT) mask.set(node as NodeId, true);
      }
      const seed = terrain.nodeAt(draw(WALLED_MAP_NODES), draw(WALLED_MAP_NODES));
      mask.set(seed, false);
      const viaCall: BlockOverlay = { has: (node) => mask.has(node), size: mask.size };
      const budget = RANDOM_BUDGETS[trial % RANDOM_BUDGETS.length] ?? WHOLE_BANK;
      const expected = stepDijkstra(terrain, seed, viaCall, budget);
      const flood = new WalkFlood(terrain, mask, [seed], budget);
      const toward = { hx: draw(WALLED_MAP_NODES), hy: draw(WALLED_MAP_NODES) };
      const answers = (blocked: BlockOverlay) => {
        const out: (number | undefined)[] = [];
        for (const mode of ['flood', 'aimed'] as const) {
          const walk = new SeedWalks(terrain, blocked, seed, budget, mode).toward(toward, WALLED_REACH);
          forEachNear(terrain, toward, (node) => out.push(walk.costFloor(node), walk.costTo(node)));
        }
        return out;
      };
      for (let id = 0; id < terrain.nodeCount; id += RANDOM_PROBE_STRIDE) {
        const node = id as NodeId;
        expect(flood.costTo(node)).toBe(expected.get(node));
      }
      expect(answers(mask)).toEqual(answers(viaCall));
    }
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
const RANDOM_TRIALS = 24;
const RANDOM_BLOCKED_PERCENT = 30;
const RANDOM_WATER_PERCENT = 15;
/** The fixture landscape's grass and water type ids. */
const GRASS_TYPE = 0;
const WATER_TYPE = 1;
const PERCENT = 100;
const RANDOM_BUDGETS = [SMALL_BUDGET, 400, WHOLE_BANK];
/** Every how many node ids the flood is asked about, so a trial asks across the whole map. */
const RANDOM_PROBE_STRIDE = 7;
const RANDOM_SEED = 2024;
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 2 ** 31;

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
