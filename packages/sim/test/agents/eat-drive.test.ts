import { describe, expect, it } from 'vitest';
import {
  Age,
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  Position,
  Resource,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import {
  aiSystem,
  atomicSystem,
  BABY_FEMALE,
  CHILD_FEMALE,
  CHILD_MALE,
  EAT_ANIMATION_REPEATS,
  GROWUP_TICKS,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt as fixtureSettlerAt } from '../fixtures/settler.js';
import { cellOf, ctxOf, grassMap, justAbove, NEED_THRESHOLD, needsSettlerAt } from './needs/support.js';

/**
 * Unit + integration tests for the EAT DRIVE — the planner choosing an `eat` atomic (id 10, the
 * original's eat-slot) when a settler's hunger crosses the threshold, consuming a food good from its
 * own carry or the nearest store holding food, closing the NeedsSystem's rise→eat→reset loop.
 *
 * Fixture food: good 3 = `food_simple` (recognised by the `food` id prefix, isFood); the viking tribe
 * binds eat atomic 10 → "viking_eat" (length 5); the headquarters (building 1) declares a food stock
 * slot, so it can be the larder a settler eats from. The eat atomic id (10) is pinned to the original
 * `setatomic <job> 10 "..._eat_slot_food"` bindings; the ¾·ONE threshold + "which good is food"
 * (slug-inferred) are approximated (source basis).
 */

const WOOD = 1;
const FOOD = 3;
const VIKING = 1;
const HEADQUARTERS = 1;
const EAT_ATOMIC = 10;
// Just over the ¾·ONE eat threshold — a settler this hungry seeks food before any work.
const HUNGRY: Fixed = justAbove(NEED_THRESHOLD);
// Comfortably below the threshold — a fed settler ignores the eat drive and works as normal.
const FED: Fixed = fx.div(ONE, fx.fromInt(2));

function settlerAt(sim: Simulation, x: number, y: number, hunger: Fixed): Entity {
  return needsSettlerAt(sim, x, y, { hunger });
}

/** A headquarters store at (x,y), optionally pre-stocked with `food` units of food. */
function storeAt(sim: Simulation, x: number, y: number, food = 0): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  const amounts = new Map<number, number>();
  if (food > 0) amounts.set(FOOD, food);
  sim.world.add(e, Stockpile, { amounts });
  return e;
}

describe('eatDrive — the planner choosing to eat', () => {
  it('starts an eat atomic (duration from content) when hungry and standing on a food store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 2, 0, HUNGRY);
    const store = storeAt(sim, 2, 0, 3); // same cell, holds food

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC);
    // The eat clip ("viking_eat", length 5) repeated EAT_ANIMATION_REPEATS times — a visible meal, not a
    // quarter-second flicker (see actions.ts). 5 × 8 = 40 ticks.
    expect(atomic.duration).toBe(5 * EAT_ANIMATION_REPEATS);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD, from: store });
  });

  it('walks to the nearest food store when hungry and not standing on one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    storeAt(sim, 4, 0, 2); // distance 4
    storeAt(sim, 2, 0, 2); // distance 2 — should win

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 2, 0));
  });

  it('eats its own carried food in place (no walk) ahead of seeking a store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    sim.world.add(settler, Carrying, { goodType: FOOD, amount: 2 });
    storeAt(sim, 4, 0, 5); // a store exists, but the settler should eat its carry first

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD, from: null });
  });

  it('ignores the eat drive below the threshold (a fed settler works normally)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, FED);
    storeAt(sim, 4, 0, 5); // food is available, but the settler is not hungry
    // A wood node to harvest, so "works normally" has something to do.
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });

    aiSystem(sim.world, ctxOf(sim));

    // Headed for the wood, not the larder — the eat drive did not fire.
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('falls through to work when hungry but no food is reachable', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    // No food anywhere — just a wood node. The settler keeps working rather than freezing.
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });
});

describe('eat atomic — consuming food + resetting hunger (AtomicSystem)', () => {
  it('consumes one unit from a store and zeroes hunger on completion', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const store = storeAt(sim, 0, 0, 3);
    sim.world.add(settler, CurrentAtomic, {
      atomicId: EAT_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1, // completes the first tick
      effect: { kind: 'eat', goodType: FOOD, from: store },
      targetEntity: store,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(store, Stockpile).amounts.get(FOOD)).toBe(2); // one unit eaten
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.fromInt(0)); // hunger reset
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // atomic done
  });

  it('consumes one unit from the carried load (from=null), dropping Carrying when empty', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    sim.world.add(settler, Carrying, { goodType: FOOD, amount: 1 });
    sim.world.add(settler, CurrentAtomic, {
      atomicId: EAT_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'eat', goodType: FOOD, from: null },
      targetEntity: settler,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, Carrying)).toBe(false); // last carried unit eaten
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.fromInt(0));
  });
});

describe('eat drive — closing the rise→eat→reset loop through the real schedule', () => {
  it('a settler beside a larder gets hungry, walks over, eats, and its hunger resets', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(3, 1) });
    // Start the settler already near the threshold so it crosses within a short headless run.
    const settler = settlerAt(sim, 0, 0, NEED_THRESHOLD);
    const FOOD_START = 10;
    const larder = storeAt(sim, 1, 0, FOOD_START); // one tile over

    let ateAtLeastOnce = false;
    let peakHunger = sim.world.get(settler, Settler).hunger;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const h = sim.world.get(settler, Settler).hunger;
      if (h > peakHunger) peakHunger = h;
      // A reset to (near) zero after having been hungry is the eat→reset signal.
      if (h < fx.div(ONE, fx.fromInt(4))) ateAtLeastOnce = true;
    }

    expect(ateAtLeastOnce).toBe(true); // the loop closed: hunger rose, the settler ate, it reset
    expect(peakHunger).toBeLessThanOrEqual(ONE); // never breached the hungerInRange ceiling
    // Food was actually consumed from the larder (goods conserved — not conjured).
    expect(sim.world.get(larder, Stockpile).amounts.get(FOOD) ?? 0).toBeLessThan(FOOD_START);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(3, 1) });
      settlerAt(sim, 0, 0, NEED_THRESHOLD);
      storeAt(sim, 1, 0, 10);
      for (let i = 0; i < 200; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('eat drive — age classes (a child self-feeds, a baby is cared for)', () => {
  /** A born-young settler: the given age-class jobType plus the Age the GrowthSystem stamps at birth. */
  function youngAt(sim: Simulation, x: number, y: number, jobType: number, ageTicks: number): Entity {
    const e = fixtureSettlerAt(sim, {
      jobType,
      needs: { hunger: HUNGRY },
      position: { x: fx.fromInt(x), y: fx.fromInt(y) },
    });
    sim.world.add(e, Age, { ticks: ageTicks });
    return e;
  }

  it('a hungry child standing on a food store starts the eat atomic (the original binds child eat clips)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const child = youngAt(sim, 2, 0, CHILD_FEMALE, GROWUP_TICKS);
    const store = storeAt(sim, 2, 0, 3);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(child, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD, from: store });
  });

  it('a hungry child away from food walks to the nearest store like an adult', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const child = youngAt(sim, 0, 0, CHILD_MALE, GROWUP_TICKS);
    storeAt(sim, 3, 0, 2);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(child, CurrentAtomic)).toBe(false);
    expect(sim.world.get(child, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('a hungry baby never seeks food — it is cared for, not self-feeding', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const baby = youngAt(sim, 2, 0, BABY_FEMALE, 0);
    storeAt(sim, 2, 0, 3); // food right under it, still ignored

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(baby, CurrentAtomic)).toBe(false);
  });
});
