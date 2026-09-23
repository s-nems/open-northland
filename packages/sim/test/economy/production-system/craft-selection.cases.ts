import { describe, expect, it } from 'vitest';
import {
  Building,
  CraftSelection,
  JobAssignment,
  Owner,
  Position,
  Production,
  Settler,
  Stockpile,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { productionSystem } from '../../../src/systems/index.js';
import { setCraftGoods, setJob } from '../../../src/systems/orders/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  CARPENTER,
  CYCLE_TICKS,
  ctxOf,
  PLANK_GATE_EARNED,
  spawnSettler,
  WOOD,
  WOOD_TRACK,
  WOODCUTTER,
} from './support.js';

// The fixture forge (typeId 9): one carpenter operator, TWO per-product recipes off the same wood
// input - wood → plank (2) and wood → food_simple (3), in that content order.
const FORGE = 9;
const PLANK = 2;
const FOOD = 3;
/** A good typeId the forge has no recipe for - the invalid/orphaned-pick cases. */
const UNMADE = 99;

function forge(sim: Simulation, wood: number): { forge: Entity; smith: Entity } {
  spawnSettler(sim, WOODCUTTER, 9, 9); // the tech enabler - plank is gated on a woodcutter existing
  const building = sim.world.create();
  sim.world.add(building, Building, { buildingType: FORGE, tribe: 1, built: ONE, level: 0 });
  sim.world.add(building, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(building, Stockpile, { amounts: new Map([[WOOD, wood]]) });
  // Spawned with the fixture's `needforgood PLANK` row earned, like the sawmill's worker - the
  // needforgood rotation gate has its own case below (which clears the XP again).
  const smith = spawnSettler(sim, CARPENTER, 0, 0, PLANK_GATE_EARNED);
  // An orderable, bound operator: setCraftGoods requires an OWNED settler with a workplace binding.
  sim.world.add(smith, Owner, { player: 0 });
  sim.world.add(smith, JobAssignment, { workplace: building });
  return { forge: building, smith };
}

/** Run the system until `count` cycles have completed (each takes CYCLE_TICKS + the start tick). */
function runCycles(sim: Simulation, count: number): void {
  for (let t = 0; t < (CYCLE_TICKS + 1) * count + 1; t++) productionSystem(sim.world, ctxOf(sim));
}

describe('productionSystem - per-product recipes and the craft selection', () => {
  it('a worker with no selection rotates through every product (1 plank, 1 food, 1 plank…)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f } = forge(sim, 4);
    runCycles(sim, 4);
    const stock = sim.world.get(f, Stockpile).amounts;
    expect(stock.get(WOOD)).toBe(0);
    expect(stock.get(PLANK)).toBe(2);
    expect(stock.get(FOOD)).toBe(2);
  });

  it('each in-flight cycle carries the product it crafts', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f } = forge(sim, 2);
    productionSystem(sim.world, ctxOf(sim)); // starts the first cycle
    expect(sim.world.get(f, Production).cycles[0]?.goodType).toBe(PLANK); // first product in content order
  });

  it('setCraftGoods pins the worker to the chosen product only', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f, smith } = forge(sim, 4);
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [FOOD] });
    runCycles(sim, 4);
    const stock = sim.world.get(f, Stockpile).amounts;
    // 4 base + 1 whole experience-bonus unit: the smith's four batches bank 17+29+38+46% of extra
    // output, crossing 1.0 on the fourth (see the production bonus cases).
    expect(stock.get(FOOD)).toBe(5);
    expect(stock.get(PLANK) ?? 0).toBe(0);
  });

  it('a multi-good selection alternates between exactly the chosen products', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f, smith } = forge(sim, 4);
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [FOOD, PLANK] });
    runCycles(sim, 4);
    const stock = sim.world.get(f, Stockpile).amounts;
    expect(stock.get(PLANK)).toBe(2);
    expect(stock.get(FOOD)).toBe(2);
  });

  it('an empty selection removes the component (back to the all-products default)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { smith } = forge(sim, 4);
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [FOOD] });
    expect(sim.world.get(smith, CraftSelection).goods).toEqual([FOOD]);
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [] });
    expect(sim.world.has(smith, CraftSelection)).toBe(false);
  });

  it('drops goods the workplace does not make; a selection with none left is ignored', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { smith } = forge(sim, 4);
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [UNMADE] });
    expect(sim.world.has(smith, CraftSelection)).toBe(false); // recoverable bad input - no-op
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [UNMADE, FOOD] });
    expect(sim.world.get(smith, CraftSelection).goods).toEqual([FOOD]); // invalid entry dropped
  });

  it('an employment change clears the pick (setJob routes through reidleAsJob)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { smith } = forge(sim, 4);
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [FOOD] });
    expect(sim.world.has(smith, CraftSelection)).toBe(true);
    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: smith, jobType: WOODCUTTER });
    expect(sim.world.has(smith, CraftSelection)).toBe(false);
  });

  it('an orphaned pick (naming nothing this workplace makes) degrades to all-products, not a stall', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f, smith } = forge(sim, 4);
    // Stamp a pick for a good the forge has no recipe for - the state a content rebase could leave.
    sim.world.add(smith, CraftSelection, { goods: [UNMADE], cursor: 0 });
    runCycles(sim, 2);
    const stock = sim.world.get(f, Stockpile).amounts;
    expect((stock.get(PLANK) ?? 0) + (stock.get(FOOD) ?? 0)).toBeGreaterThan(0); // still producing
  });

  it('the needforgood threshold locks a product until the operator earns its repeats', () => {
    // The fixture's own `needforgood PLANK` row (30 wood-track repeats): a FRESH smith may not forge
    // planks yet, so every batch goes to the ungated food (4 + 1 experience-bonus unit); the seeded
    // veteran path is every other case in this file.
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f, smith } = forge(sim, 4);
    sim.world.mut(smith, Settler).experience.delete(WOOD_TRACK); // back to unearned
    runCycles(sim, 4);
    const stock = sim.world.get(f, Stockpile).amounts;
    expect(stock.get(PLANK) ?? 0).toBe(0); // locked - the rotation skips it
    expect(stock.get(FOOD)).toBe(5); // the ungated ware keeps flowing
  });

  it('a pick naming only unearned goods degrades to the earned products, not a stall', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f, smith } = forge(sim, 4);
    sim.world.mut(smith, Settler).experience.delete(WOOD_TRACK); // plank unearned again
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [PLANK] });
    runCycles(sim, 2);
    const stock = sim.world.get(f, Stockpile).amounts;
    expect(stock.get(PLANK) ?? 0).toBe(0); // still locked
    expect(stock.get(FOOD) ?? 0).toBeGreaterThan(0); // kept crafting what it HAS earned
  });

  it('a blocked product is skipped, not a deadlock: the rotation crafts what it can', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f, smith } = forge(sim, 4);
    // Pin the rotation to start at FOOD, then fill the food slot so only plank can start.
    setCraftGoods(sim.world, ctxOf(sim), { kind: 'setCraftGoods', entity: smith, goods: [FOOD, PLANK] });
    sim.world.mut(f, Stockpile).amounts.set(FOOD, 20); // food slot at capacity - food can't start
    runCycles(sim, 2);
    expect(sim.world.get(f, Stockpile).amounts.get(PLANK)).toBe(2); // plank kept flowing
  });

  it('skips a product whose input stock is entirely absent', () => {
    const content = testContent();
    const secondRecipe = content.buildings.find((building) => building.typeId === FORGE)?.recipes[1];
    if (secondRecipe === undefined) throw new Error('fixture forge needs its second recipe');
    secondRecipe.inputs = [{ goodType: 6, amount: 1 }];
    const sim = new Simulation({ seed: 1, content });
    const { forge: f, smith } = forge(sim, 1);
    sim.world.add(smith, CraftSelection, { goods: [PLANK, FOOD], cursor: 1 });

    productionSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(f, Production).cycles[0]?.goodType).toBe(PLANK);
  });
});
