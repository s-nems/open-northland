import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  Owner,
  Position,
  Stockpile,
  setSettlerJob,
  setStockAmount,
  UnderConstruction,
} from '../../../src/components/index.js';
import { ZERO } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { productionSystem } from '../../../src/systems/index.js';
import { setProductionCount, setProductionGoods } from '../../../src/systems/orders/index.js';
import { testContent } from '../../fixtures/content.js';
import { grassCellMap } from '../../fixtures/terrain.js';
import { CARPENTER, ctxOf, PLANK_GATE_EARNED, spawnSettler, WOOD, WOODCUTTER } from './support.js';

// The fixture forge (typeId 9): one carpenter operator, wood -> plank (2) and wood -> food_simple (3).
const FORGE = 9;
const PLANK = 2;
const FOOD = 3;
/** The forge's shelf capacity for each of its products. */
const SHELF_CAPACITY = 20;

function forge(sim: Simulation, wood: number): { forge: Entity; smith: Entity } {
  spawnSettler(sim, WOODCUTTER, 9, 9); // the tech enabler for plank
  const building = sim.world.create();
  sim.world.add(building, Building, { buildingType: FORGE, tribe: 1, built: ONE, level: 0 });
  sim.world.add(building, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(building, Stockpile, { amounts: new Map([[WOOD, wood]]) });
  const smith = spawnSettler(sim, CARPENTER, 0, 0, PLANK_GATE_EARNED);
  sim.world.add(smith, Owner, { player: 0 });
  sim.world.add(smith, JobAssignment, { workplace: building });
  return { forge: building, smith };
}

describe('Simulation.workStatus - why a craft worker works or idles', () => {
  it('names the product of the running cycle', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { smith } = forge(sim, 2);
    expect(sim.workStatus(smith)).toBeUndefined(); // about to start: nothing to report
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.workStatus(smith)).toEqual({ kind: 'crafting', goodType: PLANK });
  });

  it('names the next product that waits for its inputs', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { smith } = forge(sim, 0);
    setProductionGoods(sim.world, ctxOf(sim), { kind: 'setProductionGoods', entity: smith, goods: [FOOD] });
    expect(sim.workStatus(smith)).toEqual({
      kind: 'waitingInput',
      goodType: FOOD,
      missingInputs: [{ goodType: WOOD, required: 1, available: 0, missing: 1, outOfReach: false }],
    });
  });

  it('updates missing quantities without mutating state and resumes after inputs arrive', () => {
    const base = testContent();
    const content = {
      ...base,
      buildings: base.buildings.map((building) =>
        building.typeId === FORGE
          ? {
              ...building,
              recipes: building.recipes.map((recipe) => ({
                ...recipe,
                inputs: [
                  { goodType: WOOD, amount: 3 },
                  { goodType: 4, amount: 2 },
                ],
              })),
            }
          : building,
      ),
    };
    const sim = new Simulation({ seed: 1, content });
    const { forge: f, smith } = forge(sim, 1);
    setProductionGoods(sim.world, ctxOf(sim), { kind: 'setProductionGoods', entity: smith, goods: [FOOD] });
    const before = sim.hashState();
    expect(sim.workStatus(smith)).toEqual({
      kind: 'waitingInput',
      goodType: FOOD,
      missingInputs: [
        { goodType: WOOD, required: 3, available: 1, missing: 2, outOfReach: false },
        { goodType: 4, required: 2, available: 0, missing: 2, outOfReach: false },
      ],
    });
    expect(sim.hashState()).toBe(before);
    setStockAmount(sim.world, f, WOOD, 3);
    setStockAmount(sim.world, f, 4, 2);
    expect(sim.workStatus(smith)).toBeUndefined();
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.workStatus(smith)).toEqual({ kind: 'crafting', goodType: FOOD });
  });

  it('reports a full output when every product in the rotation has no shelf room', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f, smith } = forge(sim, 2);
    const stock = sim.world.mut(f, Stockpile).amounts;
    stock.set(PLANK, SHELF_CAPACITY);
    stock.set(FOOD, SHELF_CAPACITY);
    expect(sim.workStatus(smith)).toEqual({
      kind: 'outputFull',
      outputs: [PLANK, FOOD].map((goodType) => ({
        goodType,
        available: SHELF_CAPACITY,
        capacity: SHELF_CAPACITY,
        required: 1,
      })),
    });
  });

  it('reports nothing selected when every counter is 0', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { smith } = forge(sim, 2);
    for (const goodType of [PLANK, FOOD]) {
      setProductionCount(sim.world, ctxOf(sim), {
        kind: 'setProductionCount',
        entity: smith,
        goodType,
        count: 0,
      });
    }
    expect(sim.workStatus(smith)).toEqual({ kind: 'nothingSelected' });
  });

  it('reports a workplace still under construction', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { forge: f, smith } = forge(sim, 2);
    sim.world.add(f, UnderConstruction, { labor: ZERO });
    expect(sim.workStatus(smith)).toEqual({ kind: 'workplaceUnderConstruction' });
  });

  it('reports a tradeless adult and an unposted craft worker', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const unposted = spawnSettler(sim, CARPENTER, 0, 0);
    expect(sim.workStatus(unposted)).toEqual({ kind: 'noWorkplace' });
    const tradeless = spawnSettler(sim, CARPENTER, 1, 0);
    setSettlerJob(sim.world, tradeless, null);
    expect(sim.workStatus(tradeless)).toEqual({ kind: 'noJob' });
  });
});

describe('Simulation.workStatus - stores outside the signpost area', () => {
  // The walk range is 50 hex nodes, 25 tiles east-west; the forge stands at tile 0 with no signposts.
  const IN_AREA = 6;
  const OUT_OF_AREA = 40;
  const HEADQUARTERS = 1;

  function confinedForge(wood: number): { sim: Simulation; forge: Entity; smith: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(96, 8) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    return { sim, ...forge(sim, wood) };
  }

  function storeAt(sim: Simulation, x: number, amounts: readonly [number, number][] = []): Entity {
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(x), y: fx.fromInt(2) });
    sim.world.add(store, Stockpile, { amounts: new Map(amounts) });
    if (amounts.length === 0) {
      sim.world.add(store, Building, { buildingType: HEADQUARTERS, tribe: 1, built: ONE, level: 0 });
    }
    return store;
  }

  it('names the product no store within reach takes, and a full shelf once one is in reach', () => {
    const { sim, forge: f, smith } = confinedForge(2);
    const stock = sim.world.mut(f, Stockpile).amounts;
    stock.set(PLANK, SHELF_CAPACITY);
    stock.set(FOOD, SHELF_CAPACITY);
    storeAt(sim, OUT_OF_AREA);
    expect(sim.workStatus(smith)).toEqual({
      kind: 'noOutputDestination',
      goodType: PLANK,
      reason: 'outOfReach',
    });
    storeAt(sim, IN_AREA);
    expect(sim.workStatus(smith)).toMatchObject({ kind: 'outputFull' });
  });

  it('marks a missing input that only lies outside the area', () => {
    const { sim, smith } = confinedForge(0);
    storeAt(sim, OUT_OF_AREA, [[WOOD, 5]]);
    expect(sim.workStatus(smith)).toMatchObject({
      kind: 'waitingInput',
      missingInputs: [{ goodType: WOOD, outOfReach: true }],
    });
    storeAt(sim, IN_AREA, [[WOOD, 5]]);
    expect(sim.workStatus(smith)).toMatchObject({
      kind: 'waitingInput',
      missingInputs: [{ goodType: WOOD, outOfReach: false }],
    });
  });
});
