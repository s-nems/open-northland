import { describe, expect, it } from 'vitest';
import { ProductionBonus, SettlerProgress, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import {
  EXPERIENCE_XP_PER_POINT,
  experienceBonusTenths,
  experiencePercent,
  productionSystem,
} from '../../../src/systems/index.js';
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

  it('shelves the whole bonus past the capacity when the cycle started one short of full', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Plank capacity is 20 (fixture sawmill): the cycle starts at 19, its base unit fills the shelf and
    // the master's fifteen tenths still land, one whole plank over the capacity.
    const { mill, worker } = sawmill(sim, [
      [WOOD, 1],
      [PLANK, 19],
    ]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    seedPoints(sim, worker, MASTERY);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(21);
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(5);
  });
});
