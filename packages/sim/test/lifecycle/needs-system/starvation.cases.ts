import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import { Health, Settler, setSettlerJob } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../../src/index.js';
import {
  BABY_MALE,
  CHILD_AGE_TICKS,
  CHILD_MALE,
  HUMAN_HITPOINTS,
  isNearDeath,
  REGENERATION_HITPOINTS_PER_TICK,
  STARVATION_HITPOINTS_PER_TICK,
} from '../../../src/systems/index.js';
import { woundedPersonsOf } from '../../../src/systems/lifecycle/needs/wounded.js';
import { testContent } from '../../fixtures/content.js';
import { settlerWithHunger } from './support.js';

/** The fixture monster tribe (16): no `[animaltype]` record and no `jobEnables`, as the map monsters are. */
const MONSTER_TRIBE = 16;
/** The soldier trade the decoded maps give every placed monster. */
const MONSTER_JOB = 31;
/** The hitpoint pool the original gives a human. */
const ORIGINAL_POOL = HUMAN_HITPOINTS;
/** A pool far off the original's, to show the rates do not scale with it. */
const OTHER_POOL = 300;

/** A window long enough to take many steps, so an exemption that holds across it is a real exemption. */
const SEVERAL_STEPS = 100;

/** A settler carrying a Health pool, hungry or fed as `hunger` says. */
function settlerWithPool(sim: Simulation, hunger: Fixed, hitpoints: number, max = hitpoints): Entity {
  const e = settlerWithHunger(sim, hunger);
  sim.world.add(e, Health, { hitpoints, max });
  return e;
}

function pool(sim: Simulation, e: Entity): number {
  return sim.world.tryGet(e, Health)?.hitpoints ?? 0;
}

describe('needsSystem - starvation (a pinned hunger drains hitpoints)', () => {
  it("spends the original's own pool at its two-points-a-tick rate", () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const starving = settlerWithPool(sim, ONE, ORIGINAL_POOL);
    const fed = settlerWithPool(sim, fx.fromInt(0), ORIGINAL_POOL);

    sim.step();
    expect(pool(sim, starving)).toBe(ORIGINAL_POOL - 2);
    sim.step();
    expect(pool(sim, starving)).toBe(ORIGINAL_POOL - 4);
    // The fed one is at its ceiling already, so it neither starves nor heals.
    expect(pool(sim, fed)).toBe(ORIGINAL_POOL);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('takes the same two points a tick whatever the pool', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const small = settlerWithPool(sim, ONE, OTHER_POOL);
    const large = settlerWithPool(sim, ONE, ORIGINAL_POOL);

    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, small)).toBe(OTHER_POOL - SEVERAL_STEPS * STARVATION_HITPOINTS_PER_TICK);
    expect(pool(sim, large)).toBe(ORIGINAL_POOL - SEVERAL_STEPS * STARVATION_HITPOINTS_PER_TICK);
  });

  it('starves a settler to death: the drained pool is reaped with a settlerDied event', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithPool(sim, ONE, STARVATION_HITPOINTS_PER_TICK, ORIGINAL_POOL);
    let died = false;
    for (let i = 0; i < 10 && !died; i++) {
      sim.step();
      died = sim.events.current().some((ev) => ev.kind === 'settlerDied' && ev.entity === e);
    }
    expect(died).toBe(true);
    expect(sim.world.has(e, Settler)).toBe(false); // reaped by cleanupSystem
  });

  it('exempts animals and jobless settlers (jobType null - no eat/graze path to save them)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithPool(sim, ONE, ORIGINAL_POOL);
    setSettlerJob(sim.world, e, null);
    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, e)).toBe(ORIGINAL_POOL);
  });

  it('exempts a monster-tribe soldier - its tribe declares no trades, so no store is ever its own', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // The decoded maps place 2341 of these as owned soldiers. Their bars are frozen, so this pins the
    // other half of the exemption: an already-pinned one still takes no bite.
    const e = settlerWithHunger(sim, ONE, { tribe: MONSTER_TRIBE, jobType: MONSTER_JOB });
    sim.world.add(e, Health, { hitpoints: ORIGINAL_POOL, max: ORIGINAL_POOL });
    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, e)).toBe(ORIGINAL_POOL);
  });

  for (const [stage, jobType, ageTicks] of [
    ['baby', BABY_MALE, 0],
    ['child', CHILD_MALE, CHILD_AGE_TICKS],
  ] as const) {
    it(`heals a growing settler in the ${stage} stage even on a pinned bar - it carries no needs`, () => {
      const sim = new Simulation({ seed: 1, content: testContent() });
      // An authored pinned bar is the only way a growing settler reaches one: nothing in play moves it.
      // Age matters - an adult fixture whose synthetic job id collides with an age class must still starve.
      const e = settlerWithPool(sim, ONE, OTHER_POOL, ORIGINAL_POOL);
      setSettlerJob(sim.world, e, jobType);
      sim.world.add(e, components.Age, { ticks: ageTicks });
      for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
      expect(pool(sim, e)).toBe(OTHER_POOL + SEVERAL_STEPS * REGENERATION_HITPOINTS_PER_TICK);
    });
  }

  it('stops starving while needs are disabled', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithPool(sim, ONE, ORIGINAL_POOL);
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, e)).toBe(ORIGINAL_POOL);
  });
});

describe('needsSystem - healing (a fed settler regains hitpoints)', () => {
  it("returns the original's own pool at its one-point-a-tick rate", () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithPool(sim, fx.fromInt(0), 1, ORIGINAL_POOL);

    sim.step();
    expect(pool(sim, e)).toBe(2);
    sim.step();
    expect(pool(sim, e)).toBe(3);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('refills any pool one point a tick, up to its max', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const small = settlerWithPool(sim, fx.fromInt(0), 1, OTHER_POOL);
    const nearlyWhole = settlerWithPool(sim, fx.fromInt(0), ORIGINAL_POOL - 1, ORIGINAL_POOL);

    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, small)).toBe(1 + SEVERAL_STEPS * REGENERATION_HITPOINTS_PER_TICK);
    expect(pool(sim, nearlyWhole)).toBe(ORIGINAL_POOL);
  });

  it('never heals a starving settler', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const starving = settlerWithPool(sim, ONE, ORIGINAL_POOL / 2, ORIGINAL_POOL);

    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(pool(sim, starving)).toBeLessThan(ORIGINAL_POOL / 2);
  });

  it('heals everyone as fed while needs are disabled, a pinned hunger included', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const fed = settlerWithPool(sim, fx.fromInt(0), OTHER_POOL, ORIGINAL_POOL);
    const pinned = settlerWithPool(sim, ONE, OTHER_POOL, ORIGINAL_POOL);
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });

    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    // The setup command applies on the first tick, before the needs pass.
    expect(pool(sim, fed)).toBe(OTHER_POOL + SEVERAL_STEPS * REGENERATION_HITPOINTS_PER_TICK);
    expect(pool(sim, pinned)).toBe(OTHER_POOL + SEVERAL_STEPS * REGENERATION_HITPOINTS_PER_TICK);
    expect(sim.checkInvariants()).toEqual([]); // the wounded list agrees with a fresh scan
  });

  it('with needs disabled, reads nobody at full health and drops a settler once it is whole', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const whole = settlerWithPool(sim, fx.fromInt(0), ORIGINAL_POOL);
    const nearlyWhole = settlerWithPool(sim, fx.fromInt(0), ORIGINAL_POOL - 2, ORIGINAL_POOL);
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.step();
    expect(woundedPersonsOf(sim.world)).toEqual([nearlyWhole]);
    const generation = sim.world.componentValueGeneration(Health);
    sim.step();
    sim.step();
    expect(pool(sim, nearlyWhole)).toBe(ORIGINAL_POOL);
    expect(woundedPersonsOf(sim.world)).toEqual([]);
    const settled = sim.world.componentValueGeneration(Health);
    for (let i = 0; i < SEVERAL_STEPS; i++) sim.step();
    expect(sim.world.componentValueGeneration(Health)).toBe(settled); // nobody's pool is written
    expect(settled).toBeGreaterThan(generation);
    expect(pool(sim, whole)).toBe(ORIGINAL_POOL);
  });
});

describe('isNearDeath - the line a dying warning reads', () => {
  it('holds from 720 of 5000 down to 1, and keeps the same share of a larger pool', () => {
    expect(isNearDeath(720, HUMAN_HITPOINTS)).toBe(true);
    expect(isNearDeath(721, HUMAN_HITPOINTS)).toBe(false);
    expect(isNearDeath(1, HUMAN_HITPOINTS)).toBe(true);
    expect(isNearDeath(0, HUMAN_HITPOINTS)).toBe(false); // dead, not dying
    expect(isNearDeath(2880, 20_000)).toBe(true);
    expect(isNearDeath(2881, 20_000)).toBe(false);
  });
});
