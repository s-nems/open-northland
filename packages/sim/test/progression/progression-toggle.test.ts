import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Owner,
  Position,
  progressionRulesEntity,
  Settler,
  setProfessionProgression,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { setJob } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/** The `setProfessionProgression` command through the real command path: the `ProgressionRules`
 *  singleton is created on first use, read back through the Simulation probe, and stays absent on a
 *  world that never issues the command (so untouched command streams keep their golden hashes). */
describe('setProfessionProgression - the rules command and its default', () => {
  it('defaults to enabled with NO singleton entity (an untouched stream keeps its hash)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.run(5);
    expect(sim.professionProgressionEnabled()).toBe(true);
    expect(progressionRulesEntity(sim.world)).toBeNull(); // absent = default, not a stored `true`
  });

  it('flips the probe through the command seam and back', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
    sim.step();
    expect(sim.professionProgressionEnabled()).toBe(false);
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: true });
    sim.step();
    expect(sim.professionProgressionEnabled()).toBe(true);
    expect(progressionRulesEntity(sim.world)).not.toBeNull(); // re-enabling keeps the singleton
  });

  it('replays deterministically: same seed and commands produce the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 7, content: testContent() });
      sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
      sim.run(10);
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('setJob - the profession tree gates the manual trade change', () => {
  const WOODCUTTER = 1;
  const CARPENTER = 2;
  const WOOD_TRACK = 1; // factor 10 in the fixture - the amount-30 gate needs 300 raw XP

  /** A sim whose carpenter trade demands 30 wood-track repeats (`needforjob 2 30 [1]`). */
  function gatedSim(): Simulation {
    const content = testContent();
    content.tribes[0]?.jobRequirements.push({
      requirement: 'need',
      target: 'job',
      targetId: CARPENTER,
      amount: 30,
      experienceTypes: [WOOD_TRACK],
    });
    return new Simulation({ seed: 1, content });
  }

  function ownedSettler(sim: Simulation, jobType: number, xp?: Map<number, number>): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(1), y: fx.fromInt(1) });
    addPerson(sim.world, e, {
      tribe: 1,
      jobType,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: xp ?? new Map<number, number>(),
    });
    sim.world.add(e, Owner, { player: 0 });
    return e;
  }

  it('refuses an unearned trade and allows it once the repeats are earned', () => {
    const sim = gatedSim();
    const fresh = ownedSettler(sim, WOODCUTTER);
    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: fresh, jobType: CARPENTER });
    expect(sim.world.get(fresh, Settler).jobType).toBe(WOODCUTTER); // gate held: trade unchanged

    const veteran = ownedSettler(sim, WOODCUTTER, new Map([[WOOD_TRACK, 300]])); // exactly 30 repeats
    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: veteran, jobType: CARPENTER });
    expect(sim.world.get(veteran, Settler).jobType).toBe(CARPENTER); // earned through the tree
  });

  it('lifts the civilian gate while profession progression is off', () => {
    const sim = gatedSim();
    setProfessionProgression(sim.world, false);
    const fresh = ownedSettler(sim, WOODCUTTER);
    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: fresh, jobType: CARPENTER });
    expect(sim.world.get(fresh, Settler).jobType).toBe(CARPENTER); // free start: any civilian trade
  });
});
