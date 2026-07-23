import { describe, expect, it } from 'vitest';
import { Production, ProductionBonus, Settler, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { ONE, Simulation } from '../../../src/index.js';
import { pickupFromStore } from '../../../src/systems/agents/effects-goods/index.js';
import { accrueBonusOutput } from '../../../src/systems/economy/production/bonus-output.js';
import { experienceBonus, productionSystem, recipesByProductOf } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { CYCLE_TICKS, ctxOf, PLANK, sawmill, WOOD } from './support.js';

const CARPENTER_GENERAL_TRACK = 3; // fixture jobExperience typeId for "carpenter general" (factor 100)
const CARPENTER_XP_PER_BATCH = 100; // the fixture track's experienceFactor

describe('productionSystem grants the operator profession XP per completed batch', () => {
  it('one completed cycle accrues the carpenter general track once', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // the batch really finished
    const xp = sim.world.get(worker, Settler).experience;
    expect(xp.get(CARPENTER_GENERAL_TRACK)).toBe(100); // one batch = one experienceFactor grant
    expect(xp.size).toBe(1); // profession-level: the good-specific carpenter_plank track untouched
  });

  it('accumulates across cycles (two planks = two grants)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { worker } = sawmill(sim, [[WOOD, 2]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    for (let t = 0; t < CYCLE_TICKS * 2 + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).experience.get(CARPENTER_GENERAL_TRACK)).toBe(200);
  });
});

describe('productionSystem accrues the experience bonus as fractional output', () => {
  /** Seed the worker with `repeats` completed batches' worth of raw XP on the carpenter track. */
  function seedRepeats(sim: Simulation, worker: Entity, repeats: number): void {
    sim.world.get(worker, Settler).experience.set(CARPENTER_GENERAL_TRACK, repeats * CARPENTER_XP_PER_BATCH);
  }

  it('a mid-experience carpenter banks its bonus fraction toward the next whole plank', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedRepeats(sim, worker, 4);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    // The cycle's own grant lands first (4 → 5 repeats), so the fraction is the curve at 5 (~52%).
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // no whole bonus unit yet
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(experienceBonus(5));
  });

  it('a mastered carpenter (100%) turns every cycle into two planks, remainder empty', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedRepeats(sim, worker, 200); // far past mastery — the curve clamps at 100%
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(2); // 1 base + 1 whole bonus
    expect(sim.world.has(mill, ProductionBonus)).toBe(false); // nothing fractional left pending
  });

  it('never consumes a slot an in-flight batch reserved, and flushes once the batch retires', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[PLANK, 19]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    const ctx = ctxOf(sim);
    // An in-flight plank batch has reserved the last free slot (capacity 20, 19 held) — its own deposit
    // is unconditional, so the banked bonus unit must not take it.
    sim.world.add(mill, Production, { cycles: [{ elapsed: 1, duration: 20, goodType: PLANK }] });
    sim.world.add(mill, ProductionBonus, { remainders: new Map([[PLANK, ONE]]) });
    const recipes = recipesByProductOf(sim.world, ctx, mill);
    accrueBonusOutput(sim.world, ctx, mill, [], { kind: 'staffed', operators: [worker] }, recipes);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(19); // the reserved slot stays free
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(ONE);
    // The batch retired: the banked unit flushes even though the crediting crew has no bonus of its own.
    sim.world.remove(mill, Production);
    accrueBonusOutput(sim.world, ctx, mill, [], { kind: 'staffed', operators: [worker] }, recipes);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20);
    expect(sim.world.has(mill, ProductionBonus)).toBe(false);
  });

  it('holds a whole bonus unit while the product is at capacity (nothing spills, nothing is lost)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Plank capacity is 20 (fixture sawmill): 19 in store + the base deposit fills it, so the whole
    // bonus unit cannot land and the remainder holds at 1.0.
    const { mill, worker } = sawmill(sim, [
      [WOOD, 1],
      [PLANK, 19],
    ]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedRepeats(sim, worker, 200);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // base deposit filled the store
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(ONE); // held, not lost
  });

  it('a withdrawal frees the slot and releases the held unit — production may never complete again', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [
      [WOOD, 1],
      [PLANK, 19],
    ]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedRepeats(sim, worker, 200);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    // Full store, one whole bonus unit banked (the case above). A porter lifts one plank out: the
    // withdrawal seam must flush the banked unit into the freed slot, not wait for another batch.
    const porter = sim.world.create();
    pickupFromStore(sim.world, ctxOf(sim), porter, mill, PLANK, 1);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // 19 + the released unit
    expect(sim.world.has(mill, ProductionBonus)).toBe(false); // nothing banked anymore
  });
});
