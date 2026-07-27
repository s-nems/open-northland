import { describe, expect, it } from 'vitest';
import {
  Age,
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Resource,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, halfCellMapFromCells, type NodeId, ONE, Simulation } from '../../src/index.js';
import {
  aiSystem,
  atomicSystem,
  BABY_FEMALE,
  CHILD_AGE_TICKS,
  CHILD_FEMALE,
  CHILD_MALE,
  EAT_HUNGER_RESTORE,
  HUNGER_RISE_PER_TICK,
} from '../../src/systems/index.js';
import { noteUnreachableGoal } from '../../src/systems/settlers/unreachable-goals.js';
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
// A dish: the fixture stocks bread only in the kitchen, which is the whole point of the case below.
const BREAD = 7;
const KITCHEN = 21;
const VIKING = 1;
const HEADQUARTERS = 1;
const EAT_ATOMIC = 10;
// The sleep slot (`setatomic <job> 8`) — the age-class cases prove a tired child reaches the ladder's
// sleep rung too.
const SLEEP_ATOMIC = 8;
// Just over the ¾·ONE eat threshold — a settler this hungry seeks food before any work.
const HUNGRY: Fixed = justAbove(NEED_THRESHOLD);
// Comfortably below the threshold — a fed settler ignores the eat drive and works as normal.
const FED: Fixed = fx.div(ONE, fx.fromInt(2));

function settlerAt(sim: Simulation, x: number, y: number, hunger: Fixed): Entity {
  return needsSettlerAt(sim, x, y, { hunger });
}

/** A kitchen at (x,y) holding `bread` loaves — a producing house whose dish is food on its own shelf. */
function kitchenAt(sim: Simulation, x: number, y: number, bread: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: KITCHEN, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[BREAD, bread]]) });
  return e;
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
    // The meal is the eat clip's own length ("viking_eat", 5) — the clip is a whole meal, so nothing
    // repeats it (see actions.ts).
    expect(atomic.duration).toBe(5);
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

  it('eats the kitchen’s own loaves off its shelf', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 2, 0, HUNGRY);
    const kitchen = kitchenAt(sim, 2, 0, 4); // same cell

    aiSystem(sim.world, ctxOf(sim));

    // A dish is edible in the house that cooks it (`carriedGoodForm`), and the eat effect takes the
    // RAW loaf off the shelf — the good the store actually holds.
    expect(sim.world.get(settler, CurrentAtomic).effect).toEqual({
      kind: 'eat',
      goodType: BREAD,
      from: kitchen,
    });
  });

  it('walks past a warehouse holding the same loaves — cargo there, not food', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 2, 0, HUNGRY);
    const warehouse = storeAt(sim, 2, 0); // same cell, loaves only
    sim.world.get(warehouse, Stockpile).amounts.set(BREAD, 4);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
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

describe('eat atomic — consuming food + relieving hunger (AtomicSystem)', () => {
  it('consumes one unit from a store and takes one meal off hunger on completion', () => {
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
    // One meal is a partial refill, not a reset — the eater is left hungry enough to come back.
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.sub(HUNGRY, EAT_HUNGER_RESTORE));
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
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.sub(HUNGRY, EAT_HUNGER_RESTORE));
  });

  it('reaps a loose ground heap eaten down to zero (no dead pile entity lingers)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    // A bare Stockpile+Position, the gatherer-yard / player-dropped heap shape, holding the last food unit.
    const heap = sim.world.create();
    sim.world.add(heap, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(heap, Stockpile, { amounts: new Map([[FOOD, 1]]) });
    sim.world.add(settler, CurrentAtomic, {
      atomicId: EAT_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'eat', goodType: FOOD, from: heap },
      targetEntity: heap,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(heap)).toBe(false); // emptied heap vanished, no zero-stock artifact
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.sub(HUNGRY, EAT_HUNGER_RESTORE));
  });

  it('keeps a building store alive after its last food unit is eaten (only loose piles reap)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const store = storeAt(sim, 0, 0, 1); // a headquarters larder down to its last unit
    sim.world.add(settler, CurrentAtomic, {
      atomicId: EAT_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'eat', goodType: FOOD, from: store },
      targetEntity: store,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(store)).toBe(true); // the warehouse persists empty
    expect(sim.world.get(store, Stockpile).amounts.get(FOOD) ?? 0).toBe(0);
  });
});

describe('eat drive — closing the rise→eat→relief loop through the real schedule', () => {
  it('a settler beside a larder gets hungry, walks over, eats, and a meal comes off its bar', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(3, 1) });
    // Start the settler already near the threshold so it crosses within a short headless run.
    const settler = settlerAt(sim, 0, 0, NEED_THRESHOLD);
    const FOOD_START = 10;
    const larder = storeAt(sim, 1, 0, FOOD_START); // one tile over

    let peakHunger = sim.world.get(settler, Settler).hunger;
    let troughHunger = peakHunger;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const h = sim.world.get(settler, Settler).hunger;
      if (h > peakHunger) peakHunger = h;
      if (h < troughHunger) troughHunger = h;
    }

    // The loop closed: hunger rose to the threshold, the settler ate, and a meal's worth came off the
    // bar — allowing for the tick's own rise landing alongside the meal.
    const oneMealBelowPeak = fx.sub(peakHunger, fx.sub(EAT_HUNGER_RESTORE, HUNGER_RISE_PER_TICK));
    expect(troughHunger).toBeLessThanOrEqual(oneMealBelowPeak);
    expect(troughHunger).toBeGreaterThan(fx.fromInt(0)); // a meal is a partial refill, never a reset
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

describe('eat drive — unreachable larders (the componentOf gate + the failed-goal memo)', () => {
  // The fixture landscape table: grass walks, water does not (`fixtures/content/economy.ts`).
  const GRASS_GROUND = 0;
  const WATER_GROUND = 1;

  /** The terrain node at cell (x, y), for stamping route state — throws when the sim has no map. */
  function nodeAtCell(sim: Simulation, x: number, y: number): NodeId {
    const node = cellOf(sim, x, y);
    if (node === undefined) throw new Error('simulation has no terrain');
    return node;
  }

  /** The store the settler's running eat atomic consumes from, or null while it is not eating. */
  function eatingFrom(sim: Simulation, settler: Entity): Entity | null {
    const atomic = sim.world.tryGet(settler, CurrentAtomic);
    return atomic?.effect.kind === 'eat' ? atomic.effect.from : null;
  }

  /** Drive the sim until `done`, or fail loudly — a silent timeout would read as a passing assertion. */
  function stepUntil(sim: Simulation, limit: number, done: () => boolean): void {
    for (let i = 0; i < limit && !done(); i++) sim.step();
    if (!done()) throw new Error(`condition not reached within ${limit} ticks`);
  }

  it('never targets a food store across uncrossable water — the componentOf gate its bush sibling has', () => {
    // An 8-cell strip with a full-height water column at x=2: cells 0–1 are the far bank.
    const typeIds = new Array<number>(8).fill(GRASS_GROUND);
    typeIds[2] = WATER_GROUND;
    const map = halfCellMapFromCells({ width: 8, height: 1, typeIds });
    const sim = new Simulation({ seed: 1, content: testContent(), map });
    const settler = settlerAt(sim, 3, 0, HUNGRY);
    storeAt(sim, 1, 0, 5); // nearer, but on the far bank — unreachable for good
    storeAt(sim, 6, 0, 5); // farther, on the settler's own bank

    aiSystem(sim.world, ctxOf(sim));

    // Straight to the reachable larder: the cross-water one never wins the pick, so the settler
    // never parks on a doomed route while its hunger keeps climbing.
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 6, 0));
  });

  it('after a failed walk to the nearest larder, eats from the second store instead of starving beside it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(9, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const near = storeAt(sim, 2, 0, 5);
    const far = storeAt(sim, 6, 0, 5);

    // Let the eat drive make its own nearest-first pick, then fail exactly that route — the state
    // routing leaves behind when the larder's door turns out to be walled off by standing bodies:
    // a failed request and no path to follow (an already-resolved walk would carry the settler to
    // the door, where eating in place is right).
    stepUntil(sim, 20, () => sim.world.has(settler, MoveGoal));
    const doomed = sim.world.get(settler, MoveGoal).cell;
    expect(doomed).toBe(cellOf(sim, 2, 0)); // sanity: the nearer larder won the first pick
    sim.world.remove(settler, PathFollow);
    sim.world.add(settler, PathRequest, { start: doomed, goal: doomed, failed: true });

    // Park, shed, re-plan: the memo retires the failed door, so the re-pick reaches the second store.
    stepUntil(sim, 600, () => eatingFrom(sim, settler) !== null);
    expect(eatingFrom(sim, settler)).toBe(far);
    expect(sim.world.get(near, Stockpile).amounts.get(FOOD)).toBe(5); // the doomed larder untouched
  });

  it('skips a memo-vetoed larder on the ring path too (a town-sized store index)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(80, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    storeAt(sim, 2, 0, 5); // nearest, but its door is on the settler's failed-goal memo
    storeAt(sim, 10, 0, 5); // the reachable second larder
    // 66 more (empty) stores push the interaction-cell index past RING_MIN_BUCKETS, so the pick runs
    // the ring sweep — the veto must hold there exactly as on the small-world linear scan.
    for (let x = 12; x < 78; x++) storeAt(sim, x, 0);
    noteUnreachableGoal(sim.world, ctxOf(sim), settler, nodeAtCell(sim, 2, 0));

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 10, 0));
  });
});

describe('eat drive — age classes (a child self-feeds, a baby is cared for)', () => {
  /** A born-young settler: the given age-class jobType plus the Age the GrowthSystem stamps at birth.
   *  Hungry unless other needs are passed. */
  function youngAt(
    sim: Simulation,
    x: number,
    y: number,
    jobType: number,
    ageTicks: number,
    needs: { hunger?: Fixed; fatigue?: Fixed } = { hunger: HUNGRY },
  ): Entity {
    const e = fixtureSettlerAt(sim, {
      jobType,
      needs,
      position: { x: fx.fromInt(x), y: fx.fromInt(y) },
    });
    sim.world.add(e, Age, { ticks: ageTicks });
    return e;
  }

  it('a hungry child standing on a food store starts the eat atomic (the original binds child eat clips)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const child = youngAt(sim, 2, 0, CHILD_FEMALE, CHILD_AGE_TICKS);
    const store = storeAt(sim, 2, 0, 3);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(child, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD, from: store });
  });

  it('a hungry child away from food walks to the nearest store like an adult', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const child = youngAt(sim, 0, 0, CHILD_MALE, CHILD_AGE_TICKS);
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

  it('a tired (not hungry) child starts the sleep atomic in place (the original binds child sleep clips)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const child = youngAt(sim, 2, 0, CHILD_MALE, CHILD_AGE_TICKS, { fatigue: HUNGRY });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(child, MoveGoal)).toBe(false); // sleep is in place — no walk
    expect(sim.world.get(child, CurrentAtomic).atomicId).toBe(SLEEP_ATOMIC);
  });
});
