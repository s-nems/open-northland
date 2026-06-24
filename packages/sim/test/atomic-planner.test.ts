import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Production,
  Resource,
  Settler,
  Stockpile,
} from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { ONE, Simulation, type TerrainMap, fx } from '../src/index.js';
import { type SystemContext, aiSystem } from '../src/systems/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Unit + integration tests for the AISystem's ATOMIC-UTILITY planner — the *what* layer that picks
 * the next atomic for an idle settler and sequences the harvest→carry→pileup chain, sitting on top
 * of the navigation planner (the *where*). The fixture: good 1 = wood (harvest atomic 24), job 1 =
 * woodcutter (allowed atomic 24), tribe 1 = viking (binds 24 → "viking_chop", length 3), building 1
 * = headquarters (a passive store with a wood slot, no recipe — so the ProductionSystem leaves the
 * deposited wood alone). The chain is driven through the real `step()` schedule end to end.
 */

const GRASS = 0;
const WOOD = 1;
const WOODCUTTER = 1;
const VIKING = 1;
// The deposit target is a passive STORE (the headquarters, buildingType 1, with a wood stock slot and
// no recipe) — not the sawmill: the sawmill is a workplace whose ProductionSystem would consume the
// deposited wood, which is a separate slice's behavior. These tests check the harvest→carry→pileup
// chain, so they want a building that just accumulates wood.
const HEADQUARTERS = 1;
const HARVEST_ATOMIC = 24;

// Component stores are module-level singletons (see pathfinding-system.test.ts) — clear the ones this
// suite touches before each case so membership assertions are scoped to the current test.
beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Resource.store.clear();
  Building.store.clear();
  Stockpile.store.clear();
  Carrying.store.clear();
  CurrentAtomic.store.clear();
  MoveGoal.store.clear();
  PathFollow.store.clear();
  PathRequest.store.clear();
  Production.store.clear();
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

function woodcutterAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    experience: new Map(),
  });
  return e;
}

function woodAt(sim: Simulation, x: number, y: number, remaining = 5): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WOOD, remaining, harvestAtomic: HARVEST_ATOMIC });
  return e;
}

function storeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

describe('atomicPlanner — choosing the next atomic', () => {
  it('sets a MoveGoal to the nearest harvestable resource when empty-handed and not on one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cutter, MoveGoal)).toBe(true);
    expect(sim.world.get(cutter, MoveGoal).cell).toBe(sim.terrain?.cellAt(3, 0));
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
  });

  it('starts a harvest atomic (duration from content) when standing on a resource', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 3, 0);
    const node = woodAt(sim, 3, 0); // same cell

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cutter, MoveGoal)).toBe(false);
    const atomic = sim.world.get(cutter, CurrentAtomic);
    expect(atomic.atomicId).toBe(HARVEST_ATOMIC);
    expect(atomic.duration).toBe(3); // resolved via viking setatomic -> viking_chop length 3
    expect(atomic.effect).toEqual({ kind: 'harvest', resource: node, goodType: WOOD });
  });

  it('picks the NEAREST harvestable resource (Manhattan), tie-broken by cell id', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 4, 0); // distance 4
    woodAt(sim, 2, 0); // distance 2 — should win
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cutter, MoveGoal).cell).toBe(sim.terrain?.cellAt(2, 0));
  });

  it('does not harvest a resource its job is not allowed to (data-driven gate)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    // A resource harvested with a different atomic the woodcutter does not have in allowedAtomics.
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(e, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 99 });
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(cutter, MoveGoal)).toBe(false); // nothing it may harvest -> idle
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
  });

  it('ignores a depleted resource (remaining 0)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 3, 0, 0); // depleted
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(cutter, MoveGoal)).toBe(false);
  });

  it('sets a MoveGoal to a store when carrying and not on one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    sim.world.add(cutter, Carrying, { goodType: WOOD, amount: 1 });
    storeAt(sim, 4, 0);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cutter, MoveGoal).cell).toBe(sim.terrain?.cellAt(4, 0));
  });

  it('starts a pileup atomic when carrying and standing on a store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 4, 0);
    sim.world.add(cutter, Carrying, { goodType: WOOD, amount: 1 });
    const store = storeAt(sim, 4, 0);
    aiSystem(sim.world, ctxOf(sim));
    const atomic = sim.world.get(cutter, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'pileup', store });
  });

  it('does nothing while an atomic is already running', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 3, 0);
    sim.world.add(cutter, CurrentAtomic, {
      atomicId: 1,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 5,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(cutter, MoveGoal)).toBe(false); // busy — planner left it alone
  });

  it('an unemployed settler (no job) runs no atomics', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, Settler, { tribe: VIKING, jobType: null, hunger: fx.fromInt(0), experience: new Map() });
    woodAt(sim, 3, 0);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, MoveGoal)).toBe(false);
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });
});

describe('atomicPlanner — end-to-end harvest -> carry -> pileup through the real schedule', () => {
  it('a woodcutter walks to wood, harvests, walks to the store, and piles it up', () => {
    // Layout on a 1-row grass strip: cutter at 0, wood at 1, store at 2 (short hops keep it fast).
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 1, 0, 5);
    const store = storeAt(sim, 2, 0);

    // Run until the store has wood (one full harvest→carry→pileup cycle), with a generous cap.
    let deposited = 0;
    for (let i = 0; i < 60 && deposited === 0; i++) {
      sim.step();
      deposited = sim.world.get(store, Stockpile).amounts.get(WOOD) ?? 0;
    }

    expect(deposited).toBe(1); // exactly one unit harvested and deposited
    expect(sim.world.has(cutter, Carrying)).toBe(false); // unloaded at the store
  });

  it('keeps cycling: a second unit lands in the store on a longer run', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    woodcutterAt(sim, 0, 0);
    woodAt(sim, 1, 0, 5);
    const store = storeAt(sim, 2, 0);
    for (let i = 0; i < 200; i++) sim.step();
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD) ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('depletes a finite node: a 3-unit tree empties and exactly 3 units reach the store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    const tree = woodAt(sim, 1, 0, 3); // only three units to give
    const store = storeAt(sim, 2, 0);

    // Long enough to harvest the node dry and haul every unit (each cycle is ~tens of ticks).
    for (let i = 0; i < 600; i++) sim.step();

    expect(sim.world.get(tree, Resource).remaining).toBe(0); // node fully harvested
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD)).toBe(3); // and exactly its 3 units stored
    expect(sim.world.has(cutter, Carrying)).toBe(false); // cutter is unloaded, nothing left to take
  });
});

describe('atomicPlanner — determinism', () => {
  it('two same-seed runs of the full chain reach the same state hash', () => {
    const run = (): string => {
      Position.store.clear();
      Settler.store.clear();
      Resource.store.clear();
      Building.store.clear();
      Stockpile.store.clear();
      Carrying.store.clear();
      CurrentAtomic.store.clear();
      MoveGoal.store.clear();
      PathFollow.store.clear();
      PathRequest.store.clear();
      Production.store.clear();
      const sim = new Simulation({ seed: 11, content: testContent(), map: grassMap(4, 1) });
      woodcutterAt(sim, 0, 0);
      woodAt(sim, 1, 0, 5);
      storeAt(sim, 2, 0);
      for (let i = 0; i < 80; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
