import { describe, expect, it } from 'vitest';
import { Production, ProductionBonus, SettlerProgress, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { accrueBonusOutput } from '../../../src/systems/economy/production/bonus-output.js';
import {
  EXPERIENCE_XP_PER_POINT,
  experienceBonusTenths,
  experiencePercent,
  OUTPUT_TENTHS_PER_UNIT,
  productionSystem,
  recipesByProductOf,
} from '../../../src/systems/index.js';
import { pickupFromStore } from '../../../src/systems/settlers/atomics/effects/goods/index.js';
import { testContent } from '../../fixtures/content.js';
import { CYCLE_TICKS, ctxOf, PLANK, sawmill, WOOD, WOOD_TRACK } from './support.js';

const CARPENTER_GENERAL_TRACK = 3; // fixture jobExperience typeId for "carpenter general" (factor 100)
const CARPENTER_PLANK_TRACK = 4; // the good-specific "carpenter plank" track (factor 7)
const CARPENTER_XP_PER_BATCH = 100; // the fixture track's experienceFactor
const PLANK_XP_PER_BATCH = 7;

describe('productionSystem grants the operator profession XP per completed batch', () => {
  it('one completed cycle accrues the carpenter general track once', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // the batch really finished
    const xp = sim.world.get(worker, SettlerProgress).experience;
    expect(xp.get(CARPENTER_GENERAL_TRACK)).toBe(100); // one batch = one experienceFactor grant
    // The seeded plank-gate entry, the general track and the good-specific plank track.
    expect(xp.get(CARPENTER_PLANK_TRACK)).toBe(PLANK_XP_PER_BATCH);
    expect([...xp.keys()].sort()).toEqual([WOOD_TRACK, CARPENTER_GENERAL_TRACK, CARPENTER_PLANK_TRACK]);
  });

  it('accumulates across cycles (two planks = two grants)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { worker } = sawmill(sim, [[WOOD, 2]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    for (let t = 0; t < CYCLE_TICKS * 2 + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, SettlerProgress).experience.get(CARPENTER_GENERAL_TRACK)).toBe(200);
  });
});

describe('productionSystem accrues the experience bonus in tenths of a unit', () => {
  /** Seed the worker so the cycle's own grant lands it on exactly `points` curve points. */
  function seedPoints(sim: Simulation, worker: Entity, points: number): void {
    sim.world
      .mut(worker, SettlerProgress)
      .experience.set(CARPENTER_PLANK_TRACK, points * EXPERIENCE_XP_PER_POINT - PLANK_XP_PER_BATCH);
  }
  const MASTERY = 200; // points, past the curve's plateau

  it('a mid-experience carpenter banks its tenths toward the next whole plank', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedPoints(sim, worker, 5);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    // The cycle's own grant lands first, so the credit is the curve at 5 points (51%): 7 tenths.
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // no whole bonus unit yet
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(
      experienceBonusTenths(experiencePercent(5)),
    );
    expect(experienceBonusTenths(experiencePercent(5))).toBe(7);
  });

  it('uses the product specialization instead of faster-growing general trade experience', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    const xp = sim.world.mut(worker, SettlerProgress).experience;
    xp.set(CARPENTER_GENERAL_TRACK, 69 * CARPENTER_XP_PER_BATCH);
    seedPoints(sim, worker, 9);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    // The completed plank raises its own specialization to 9 points (66%, 9 tenths). General trade XP
    // from other products must not lend its 90%-plus bonus to this one.
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(
      experienceBonusTenths(experiencePercent(9)),
    );
    expect(experienceBonusTenths(experiencePercent(9))).toBe(9);
  });

  it('a mastered carpenter (100%) makes two and a half planks: two shelved, five tenths banked', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedPoints(sim, worker, MASTERY);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(2); // 1 base + 1 whole bonus
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(5);
  });

  it('never consumes a slot an in-flight batch reserved, and flushes once the batch retires', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[PLANK, 19]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    const ctx = ctxOf(sim);
    // An in-flight plank batch has reserved the last free slot (capacity 20, 19 held) - its own deposit
    // is unconditional, so the banked bonus unit must not take it.
    sim.world.add(mill, Production, { cycles: [{ elapsed: 1, duration: 20, goodType: PLANK }] });
    sim.world.add(mill, ProductionBonus, { remainders: new Map([[PLANK, OUTPUT_TENTHS_PER_UNIT]]) });
    const recipes = recipesByProductOf(sim.world, ctx, mill);
    accrueBonusOutput(sim.world, ctx, mill, [], { kind: 'staffed', operators: [worker] }, recipes);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(19); // the reserved slot stays free
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(OUTPUT_TENTHS_PER_UNIT);
    // The batch retired: the banked unit flushes even though the crediting crew has no bonus of its own.
    sim.world.remove(mill, Production);
    accrueBonusOutput(sim.world, ctx, mill, [], { kind: 'staffed', operators: [worker] }, recipes);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20);
    expect(sim.world.has(mill, ProductionBonus)).toBe(false);
  });

  it('holds a whole bonus unit while the product is at capacity (nothing spills, nothing is lost)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Plank capacity is 20 (fixture sawmill): 19 in store + the base deposit fills it, so the master's
    // fifteen tenths cannot land and hold whole.
    const { mill, worker } = sawmill(sim, [
      [WOOD, 1],
      [PLANK, 19],
    ]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedPoints(sim, worker, MASTERY);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // base deposit filled the store
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(15); // held, not lost
  });

  it('a withdrawal frees the slot and releases the held unit - production may never complete again', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [
      [WOOD, 1],
      [PLANK, 19],
    ]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedPoints(sim, worker, MASTERY);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    // Full store, one whole bonus unit banked (the case above). A porter lifts one plank out: the
    // withdrawal seam must flush the banked unit into the freed slot, not wait for another batch.
    const porter = sim.world.create();
    pickupFromStore(sim.world, ctxOf(sim), porter, mill, PLANK, 1);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // 19 + the released unit
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(5); // the tenths stay banked
  });
});
