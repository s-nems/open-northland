import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import { Health, Settler, setSettlerJob } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import {
  BABY_MALE,
  CHILD_AGE_TICKS,
  CHILD_MALE,
  HEAL_STEPS_TO_FULL,
  HEALTH_STEP_INTERVAL_TICKS,
  STARVATION_BITES_TO_DIE,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { settlerWithHunger } from './support.js';

/** The fixture monster tribe (16): no `[animaltype]` record and no `jobEnables`, as the map monsters are. */
const MONSTER_TRIBE = 16;
/** The soldier trade the decoded maps give every placed monster. */
const MONSTER_JOB = 31;

describe('needsSystem - starvation (a pinned hunger drains hitpoints)', () => {
  /** A settler whose hunger is already pinned at ONE, carrying an explicit Health pool. */
  function starvingSettler(sim: Simulation, hitpoints: number): Entity {
    const e = settlerWithHunger(sim, ONE);
    sim.world.add(e, Health, { hitpoints, max: hitpoints });
    return e;
  }

  it('bites hitpoints on the interval beat only while hunger is pinned at ONE', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const starving = starvingSettler(sim, 300);
    const fed = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.add(fed, Health, { hitpoints: 300, max: 300 });

    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 3; i++) sim.step();
    // 300/240 truncates to 1 → the 1-damage floor, one bite per interval; the fed settler is at its
    // ceiling already, so it neither starves nor heals.
    expect(sim.world.get(starving, Health).hitpoints).toBe(300 - 3);
    expect(sim.world.get(fed, Health).hitpoints).toBe(300);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('scales the bite with the pool so any pool empties in ~STARVATION_BITES_TO_DIE intervals', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 2400);
    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(2400 - 2400 / STARVATION_BITES_TO_DIE);
  });

  it('starves a settler to death: the drained pool is reaped with a settlerDied event', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 2); // two bites to die (fast-forward the death without 2400 ticks)
    let died = false;
    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 2 + 1 && !died; i++) {
      sim.step();
      died = sim.events.current().some((ev) => ev.kind === 'settlerDied' && ev.entity === e);
    }
    expect(died).toBe(true);
    expect(sim.world.has(e, Settler)).toBe(false); // reaped by cleanupSystem
  });

  it('exempts animals and jobless settlers (jobType null - no eat/graze path to save them)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 300);
    setSettlerJob(sim.world, e, null);
    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });

  it('exempts a monster-tribe soldier - its tribe declares no trades, so no store is ever its own', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // The decoded maps place 2341 of these as owned soldiers. Their bars are frozen, so this pins the
    // other half of the exemption: an already-pinned one still takes no bite.
    const e = settlerWithHunger(sim, ONE, { tribe: MONSTER_TRIBE, jobType: MONSTER_JOB });
    sim.world.add(e, Health, { hitpoints: 300, max: 300 });
    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });

  for (const [stage, jobType, ageTicks] of [
    ['baby', BABY_MALE, 0],
    ['child', CHILD_MALE, CHILD_AGE_TICKS],
  ] as const) {
    it(`exempts a growing settler in the ${stage} stage - it carries no needs to starve on`, () => {
      const sim = new Simulation({ seed: 1, content: testContent() });
      // An authored pinned bar is the only way a growing settler reaches one: nothing in play moves it.
      // Age matters - an adult fixture whose synthetic job id collides with an age class must still starve.
      const e = starvingSettler(sim, 300);
      setSettlerJob(sim.world, e, jobType);
      sim.world.add(e, components.Age, { ticks: ageTicks });
      for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 2; i++) sim.step();
      expect(sim.world.get(e, Health).hitpoints).toBe(300);
    });
  }

  it('stops starving while needs are disabled', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 300);
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });
});

describe('needsSystem - healing (a fed settler regains hitpoints)', () => {
  /** A settler whose hunger is pinned at ONE, carrying an explicit Health pool. */
  function starvingSettler(sim: Simulation, hitpoints: number): Entity {
    const e = settlerWithHunger(sim, ONE);
    sim.world.add(e, Health, { hitpoints, max: hitpoints });
    return e;
  }

  it('heals a wounded fed settler one step per interval, up to its own ceiling', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.add(e, Health, { hitpoints: 100, max: 300 });

    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 3; i++) sim.step();
    // 300/480 truncates to 0 → the 1-hitpoint floor, one step per interval.
    expect(sim.world.get(e, Health).hitpoints).toBe(103);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('scales the step with the pool, at half the rate starvation drains it', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.add(e, Health, { hitpoints: 1, max: 4800 });

    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(1 + 4800 / HEAL_STEPS_TO_FULL);
    expect(HEAL_STEPS_TO_FULL).toBe(STARVATION_BITES_TO_DIE * 2);
  });

  it('never heals a starving settler, and never past the ceiling', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const starving = starvingSettler(sim, 300);
    sim.world.mut(starving, Health).hitpoints = 100;
    const whole = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.add(whole, Health, { hitpoints: 300, max: 300 });

    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 3; i++) sim.step();
    expect(sim.world.get(starving, Health).hitpoints).toBe(100 - 3);
    expect(sim.world.get(whole, Health).hitpoints).toBe(300);
  });

  it('heals nothing while needs are disabled', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.add(e, Health, { hitpoints: 100, max: 300 });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });

    for (let i = 0; i < HEALTH_STEP_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(100);
  });
});
